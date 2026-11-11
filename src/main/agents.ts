import * as pty from 'node-pty'
import { randomUUID } from 'crypto'
import { existsSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, resolve as resolvePath } from 'path'
import type { Agent, AgentStatus, CodeFocus, Team, TeamMember } from '../shared/types'
import { AgentBridge, HookEvent, ShowCodeArgs, TeamMessageArgs, ToolName } from './agentBridge'
import { applyOrder, dataDir, getState, updateState, type PersistedAgent } from './store'
import { claudeEnv, resolveClaude } from './tools'
import { isValidModelName, mergeAgentArgs } from '../shared/agentArgs'

/** Wird jedem Agent per --append-system-prompt mitgegeben. */
const SYSTEM_HINT =
  'You are running inside DevHub, a desktop app that shows your terminal next to a code panel. ' +
  'Whenever you analyze code, investigate a problem or find a bug, call the `show_code` tool of the ' +
  '`devhub` MCP server with the affected file and line range so the user sees the spot highlighted. ' +
  'Call it again whenever your focus moves to another location.'

const MAX_BUFFER = 200_000
/** Endet ein Agent so schnell mit Fehler, war der Start kaputt (z. B. unbekanntes Start-Flag). */
const EARLY_EXIT_MS = 8000
/** Obergrenze für Teamgröße (jeder Agent ist ein eigener claude-Prozess) */
const MAX_TEAM_SIZE = 8

interface RunningAgent {
  agent: Agent
  proc: pty.IPty
  buffer: string
  startedAt: number
  /** Über die Liste/App beendet (kein Startfehler) */
  stopping: boolean
  /** Team-Nachrichten, die vor der ersten Ausgabe ankamen (TUI noch nicht bereit) */
  pending: string[]
}

export interface StartTeamOptions {
  /** Team-Vorlage – oder freie Mitgliederliste (temporäres Team) */
  teamTemplateId?: string
  members?: TeamMember[]
  /** Name für temporäre Teams; Standard „Team N“ */
  name?: string
  /** Aufgabe für das erste Mitglied (Leitung) */
  task?: string
  /** Modell für alle Mitglieder (per Sprache genannt), hat Vorrang vor den Vorlagen */
  model?: string
}

export interface AgentEvents {
  onData: (id: string, data: string) => void
  onChanged: (agents: Agent[], teams: Team[]) => void
  onCodeFocus: (focus: CodeFocus) => void
  /** Agent hat sich direkt nach dem Start mit Fehler beendet */
  onStartFailed: (agentName: string, output: string) => void
}

export class AgentManager {
  private running = new Map<string, RunningAgent>()
  private bridge: AgentBridge
  private quitting = false
  /** Wiederherstellung nur einmal pro App-Start */
  private restored = false

  constructor(private events: AgentEvents) {
    this.bridge = new AgentBridge({
      onHook: (id, ev) => this.handleHook(id, ev),
      tools: (id) =>
        this.running.get(id)?.agent.teamId
          ? ['show_code', 'team_members', 'send_team_message']
          : ['show_code'],
      onToolCall: (id, name, args) => this.handleToolCall(id, name, args)
    })
  }

  init(): Promise<void> {
    return this.bridge.start()
  }

  /** Laufende Agents in der gespeicherten Reihenfolge (vom Nutzer per Drag & Drop festgelegt). */
  list(): Agent[] {
    const order = new Map(getState().agents.map((a, i) => [a.id, i]))
    const pos = (id: string): number => order.get(id) ?? Number.MAX_SAFE_INTEGER
    return [...this.running.values()].map((r) => r.agent).sort((a, b) => pos(a.id) - pos(b.id))
  }

  /** Neue Reihenfolge für eine Gruppe von Agents (Projekt oder Team); andere bleiben stehen. */
  reorder(ids: string[]): void {
    updateState((s) => (s.agents = applyOrder(s.agents, ids)))
    this.emitChanged()
  }

  /** Laufende Teams */
  teams(): Team[] {
    return getState().teams
  }

  buffer(id: string): string {
    return this.running.get(id)?.buffer ?? ''
  }

  /** Startet alle Agents, die beim letzten Beenden der App noch liefen. */
  async restore(): Promise<void> {
    if (this.restored) return
    this.restored = true
    const projects = new Set(getState().projects.map((p) => p.id))
    for (const saved of getState().agents) {
      if (this.running.has(saved.id)) continue
      if (!projects.has(saved.projectId)) continue
      try {
        // Wartete der Agent beim Beenden auf Eingabe, bleibt er hervorgehoben, bis er weiterarbeitet
        const { needsInput, ...agent } = saved
        await this.spawn(
          needsInput !== undefined
            ? { ...agent, status: 'needsInput', statusMessage: needsInput }
            : { ...agent, status: 'starting' },
          undefined
        )
      } catch (e) {
        console.error('[DevHub] Agent konnte nicht wiederhergestellt werden:', saved.name, e)
        updateState((s) => (s.agents = s.agents.filter((a) => a.id !== saved.id)))
      }
    }
    this.removeEmptyTeams()
    this.emitChanged()
  }

  /**
   * Startet ein Team: alle Mitglieder als eigene Agents mit gemeinsamer teamId. Erst werden alle
   * Agents gespeichert (Namen reserviert, jeder kennt beim Start seine Teamkollegen), dann gestartet.
   * Die Aufgabe bekommt nur das erste Mitglied (Leitung), das sie per Team-Nachricht verteilt.
   */
  async startTeam(projectId: string, opts: StartTeamOptions): Promise<Team> {
    const state = getState()
    const project = state.projects.find((p) => p.id === projectId)
    if (!project) throw new Error('Projekt nicht gefunden')
    const def = opts.teamTemplateId
      ? state.teamTemplates.find((t) => t.id === opts.teamTemplateId)
      : undefined
    if (opts.teamTemplateId && !def) throw new Error('Team-Vorlage nicht gefunden')
    const members = def?.members ?? opts.members ?? []
    if (members.length < 2) throw new Error('Ein Team braucht mindestens zwei Mitglieder')
    if (members.length > MAX_TEAM_SIZE)
      throw new Error(`Höchstens ${MAX_TEAM_SIZE} Agents pro Team`)
    for (const m of members) {
      if (m.templateId && !state.templates.some((t) => t.id === m.templateId))
        throw new Error('Ein Mitglied verweist auf einen gelöschten vordefinierten Agent')
    }
    const model = opts.model?.trim() || undefined
    if (model && !isValidModelName(model)) throw new Error(`Ungültiger Modellname: ${model}`)

    const team: Team = {
      id: randomUUID(),
      name: this.nextTeamName(def?.name ?? (opts.name?.trim() || undefined)),
      projectId,
      teamTemplateId: def?.id,
      temporary: !def,
      createdAt: Date.now()
    }
    updateState((s) => s.teams.push(team))

    const agents: Agent[] = []
    // Fortlaufende Zeitstempel: Reihenfolge (erstes = Leitung) bleibt eindeutig, auch nach Neustart
    const base = Date.now()
    for (const [i, m] of members.entries()) {
      const template = m.templateId ? state.templates.find((t) => t.id === m.templateId) : undefined
      const agent: Agent = {
        id: randomUUID(),
        projectId,
        name: this.nextName(template?.name),
        sessionId: randomUUID(),
        status: 'starting',
        createdAt: base + i,
        model,
        templateId: template?.id,
        teamId: team.id
      }
      updateState((s) => s.agents.push(persisted(agent)))
      agents.push(agent)
    }

    const failures: string[] = []
    for (const [i, agent] of agents.entries()) {
      try {
        await this.spawn(agent, i === 0 ? opts.task?.trim() || undefined : undefined)
      } catch (e) {
        failures.push(`${agent.name}: ${e instanceof Error ? e.message : String(e)}`)
        updateState((s) => (s.agents = s.agents.filter((a) => a.id !== agent.id)))
      }
    }
    this.removeEmptyTeams()
    this.emitChanged()
    if (failures.length === agents.length) throw new Error(failures.join('\n'))
    return team
  }

  /** Beendet alle Agents eines Teams (das Team verschwindet mit dem letzten Agent). */
  stopTeam(teamId: string): void {
    for (const a of getState().agents.filter((x) => x.teamId === teamId)) this.stop(a.id)
  }

  /**
   * model: überschreibt `--model` aus Vorlage und Start-Flags (z. B. per Sprachbefehl genannt).
   * templateId: Vorlage → Name „<Vorlage>“ / „<Vorlage> 2“ …, Modell und Anweisung der Vorlage.
   */
  async start(
    projectId: string,
    task?: string,
    model?: string,
    templateId?: string
  ): Promise<Agent> {
    const project = getState().projects.find((p) => p.id === projectId)
    if (!project) throw new Error('Projekt nicht gefunden')
    const m = model?.trim() || undefined
    if (m && !isValidModelName(m)) throw new Error(`Ungültiger Modellname: ${m}`)
    const template = templateId ? getState().templates.find((t) => t.id === templateId) : undefined
    if (templateId && !template) throw new Error('Vorlage nicht gefunden')

    const agent: Agent = {
      id: randomUUID(),
      projectId,
      name: this.nextName(template?.name),
      sessionId: randomUUID(),
      status: 'starting',
      createdAt: Date.now(),
      model: m,
      templateId: template?.id
    }
    // Erst speichern (reserviert den Namen), dann starten
    updateState((s) => s.agents.push(persisted(agent)))
    try {
      await this.spawn(agent, task?.trim() || undefined)
    } catch (e) {
      updateState((s) => (s.agents = s.agents.filter((a) => a.id !== agent.id)))
      throw e
    }
    this.emitChanged()
    return agent
  }

  stop(id: string): void {
    const r = this.running.get(id)
    if (!r) return this.forget(id)
    r.stopping = true
    r.proc.kill()
  }

  rename(id: string, name: string): void {
    const r = this.running.get(id)
    const trimmed = name.trim()
    if (!r || !trimmed) return
    r.agent.name = trimmed
    updateState((s) => {
      const a = s.agents.find((x) => x.id === id)
      if (a) a.name = trimmed
    })
    this.emitChanged()
  }

  /** Sprach-Abschicken pro Agent: true/false überschreibt die globale Einstellung, undefined = global. */
  setVoiceAutoSend(id: string, value: boolean | undefined): void {
    const r = this.running.get(id)
    if (!r) return
    r.agent.voiceAutoSend = value
    updateState((s) => {
      const a = s.agents.find((x) => x.id === id)
      if (a) a.voiceAutoSend = value
    })
    this.emitChanged()
  }

  /** Erkannten Sprachtext an den Agent geben – abschicken oder nur eintragen. true = abgeschickt. */
  async sendVoice(id: string, text: string): Promise<boolean> {
    const r = this.running.get(id)
    if (!r) throw new Error('Agent läuft nicht mehr')
    const autoSend = r.agent.voiceAutoSend ?? getState().settings.voiceAutoSend
    if (autoSend) await this.sendLine(id, text)
    else r.proc.write(text.replace(/\r?\n/g, ' '))
    return autoSend
  }

  write(id: string, data: string): void {
    this.running.get(id)?.proc.write(data)
  }

  /** Schreibt Text und schickt ihn ab. Enter separat, damit die TUI ihn nicht als Teil eines Paste behandelt. */
  async sendLine(id: string, text: string): Promise<void> {
    const r = this.running.get(id)
    if (!r) throw new Error('Agent läuft nicht')
    r.proc.write(text.replace(/\r?\n/g, ' '))
    await new Promise((res) => setTimeout(res, 150))
    r.proc.write('\r')
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols < 2 || rows < 2) return
    try {
      this.running.get(id)?.proc.resize(Math.floor(cols), Math.floor(rows))
    } catch {
      // Prozess bereits beendet
    }
  }

  /** Beim Beenden der App: Prozesse stoppen, gespeicherte Agents aber behalten (Wiederherstellung). */
  shutdown(): void {
    this.quitting = true
    for (const r of this.running.values()) {
      try {
        r.proc.kill()
      } catch {
        // ignorieren
      }
    }
    this.running.clear()
    this.bridge.stop()
  }

  // ---------------------------------------------------------------------------

  private async spawn(agent: Agent, task: string | undefined): Promise<void> {
    const project = getState().projects.find((p) => p.id === agent.projectId)
    if (!project) throw new Error('Projekt nicht gefunden')
    if (!existsSync(project.agentPath)) throw new Error(`Ordner fehlt: ${project.agentPath}`)

    const claude = await resolveClaude()
    if (!claude) throw new Error('Claude Code wurde nicht gefunden')

    const { settingsFile, mcpFile } = this.writeAgentConfig(agent.id)
    // Vorlage bei jedem Start frisch lesen → Änderungen wirken auch bei Wiederherstellung
    const template = agent.templateId
      ? getState().templates.find((t) => t.id === agent.templateId)
      : undefined
    // Modell: per Sprache genannt > Vorlage > Start-Flags (Projekt > global)
    const model = agent.model || template?.model
    // Nutzer-Flags zuerst: so beendet ein DevHub-Flag evtl. variadische Werte (z. B. --allowedTools a b),
    // und vor der Aufgabe steht immer --append-system-prompt <wert> (Aufgabe bleibt positional)
    const args = mergeAgentArgs(
      getState().settings.agentArgs,
      project.agentArgs,
      model ? ['--model', model] : []
    )
    if (sessionExists(agent.sessionId)) args.push('--resume', agent.sessionId)
    else args.push('--session-id', agent.sessionId)
    args.push('--settings', settingsFile, '--mcp-config', mcpFile)
    args.push(
      '--append-system-prompt',
      systemPrompt(agent.name, template?.instructions, this.teamContext(agent))
    )
    if (task) args.push(task)

    // claude.exe direkt starten; ein .cmd-Wrapper braucht cmd.exe (dort keine Sonderzeichen und
    // keine Zeilenumbrüche erlaubt)
    const isExe = claude.toLowerCase().endsWith('.exe')
    const file = isExe ? claude : 'cmd.exe'
    const argv = isExe
      ? args
      : [
          '/c',
          claude,
          ...args.map((a) => a.replace(/["%^&|<>]/g, ' ').replace(/\s*\r?\n\s*/g, ' '))
        ]

    const proc = pty.spawn(file, argv, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: project.agentPath,
      env: claudeEnv({ FORCE_COLOR: '1' })
    })

    if (process.env.DEVHUB_DEBUG)
      console.log('[DevHub] Agent gestartet', agent.name, file, argv.join(' '))
    const r: RunningAgent = {
      agent,
      proc,
      buffer: '',
      startedAt: Date.now(),
      stopping: false,
      pending: []
    }
    this.running.set(agent.id, r)

    proc.onData((data) => {
      r.buffer = (r.buffer + data).slice(-MAX_BUFFER)
      if (agent.status === 'starting') this.setStatus(agent.id, 'idle')
      this.events.onData(agent.id, data)
    })

    proc.onExit(({ exitCode }) => {
      this.running.delete(agent.id)
      if (this.quitting) return
      if (!r.stopping && exitCode !== 0 && Date.now() - r.startedAt < EARLY_EXIT_MS) {
        this.events.onStartFailed(agent.name, lastLines(r.buffer))
      }
      // Agent wurde im Terminal oder über die Liste beendet → Eintrag entfernen
      this.forget(agent.id)
    })
  }

  /** Pro Agent: Hooks (Status an die App melden) + MCP-Konfiguration (show_code). */
  private writeAgentConfig(agentId: string): { settingsFile: string; mcpFile: string } {
    const dir = dataDir('agents', agentId)
    // curl.exe ist ab Windows 10 enthalten; ".exe" explizit, da "curl" in PowerShell 5.1 ein Alias ist
    const hook = [
      {
        type: 'command',
        command: `curl.exe -s -m 3 -X POST -H "Content-Type: application/json" --data-binary @- ${this.bridge.hookUrl(agentId)}`
      }
    ]
    const settings = {
      hooks: {
        SessionStart: [{ hooks: hook }],
        UserPromptSubmit: [{ hooks: hook }],
        PreToolUse: [{ matcher: '*', hooks: hook }],
        PostToolUse: [{ matcher: '*', hooks: hook }],
        Notification: [{ hooks: hook }],
        Stop: [{ hooks: hook }]
      },
      permissions: {
        allow: [
          'mcp__devhub__show_code',
          'mcp__devhub__team_members',
          'mcp__devhub__send_team_message'
        ]
      }
    }
    const mcp = { mcpServers: { devhub: { type: 'http', url: this.bridge.mcpUrl(agentId) } } }

    const settingsFile = join(dir, 'settings.json')
    const mcpFile = join(dir, 'mcp.json')
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2))
    writeFileSync(mcpFile, JSON.stringify(mcp, null, 2))
    return { settingsFile, mcpFile }
  }

  private handleHook(agentId: string, ev: HookEvent): void {
    if (process.env.DEVHUB_DEBUG) {
      console.log('[DevHub] Hook', agentId.slice(0, 8), ev.hook_event_name, ev.tool_name ?? '')
    }
    switch (ev.hook_event_name) {
      case 'SessionStart':
        // Beim Fortsetzen (Wiederherstellung) den gespeicherten Wartezustand behalten
        if (ev.source === 'resume' && this.running.get(agentId)?.agent.status === 'needsInput')
          break
        this.setStatus(agentId, 'idle')
        break
      case 'UserPromptSubmit':
      case 'PostToolUse':
        this.setStatus(agentId, 'working')
        break
      case 'PreToolUse':
        // AskUserQuestion wartet auf den Nutzer, alle anderen Tools = Arbeit
        if (ev.tool_name === 'AskUserQuestion') {
          this.setStatus(agentId, 'needsInput', 'Stellt eine Frage')
        } else {
          this.setStatus(agentId, 'working')
        }
        break
      case 'Notification':
        this.setStatus(agentId, 'needsInput', ev.message || 'Benötigt Eingabe')
        break
      case 'Stop':
        this.setStatus(agentId, 'needsInput', 'Fertig – wartet auf Eingabe')
        break
    }
  }

  private async handleToolCall(
    agentId: string,
    name: ToolName,
    args: Record<string, unknown>
  ): Promise<string> {
    if (name === 'show_code') return this.handleShowCode(agentId, args as unknown as ShowCodeArgs)
    if (name === 'team_members') return this.handleTeamMembers(agentId)
    return this.handleTeamMessage(agentId, args as unknown as TeamMessageArgs)
  }

  /** Teamkollegen eines Agents (ohne ihn selbst), laufend oder noch startend. */
  private teammates(agentId: string): RunningAgent[] {
    const teamId = this.running.get(agentId)?.agent.teamId
    if (!teamId) return []
    return [...this.running.values()].filter(
      (r) => r.agent.teamId === teamId && r.agent.id !== agentId
    )
  }

  private handleTeamMembers(agentId: string): string {
    const me = this.running.get(agentId)
    const team = getState().teams.find((t) => t.id === me?.agent.teamId)
    if (!me || !team) throw new Error('You are not part of a team')
    const mates = this.teammates(agentId)
    if (mates.length === 0) return `Team "${team.name}": no other members are running.`
    const role = (a: Agent): string =>
      getState().templates.find((t) => t.id === a.templateId)?.name ?? 'general agent'
    return [
      `Team "${team.name}" – your teammates:`,
      ...mates.map(
        (r) =>
          `- ${r.agent.name} (role: ${role(r.agent)}, status: ${r.agent.status}` +
          `${r.agent.statusMessage ? ` – ${r.agent.statusMessage}` : ''})`
      )
    ].join('\n')
  }

  /**
   * Nachricht an Teamkollegen: wird als neuer Prompt in deren Terminal geschrieben (Claude Code
   * stellt sie in die Warteschlange, falls der Agent gerade arbeitet). Nur innerhalb des Teams.
   */
  private async handleTeamMessage(agentId: string, args: TeamMessageArgs): Promise<string> {
    const me = this.running.get(agentId)
    if (!me?.agent.teamId) throw new Error('You are not part of a team')
    const message = String(args.message ?? '').trim()
    const to = String(args.to ?? '').trim()
    if (!message || !to) throw new Error('"to" and "message" are required')

    const mates = this.teammates(agentId)
    const targets =
      to.toLowerCase() === 'all'
        ? mates
        : mates.filter((r) => r.agent.name.toLowerCase() === to.toLowerCase())
    if (targets.length === 0) {
      const names = mates.map((r) => r.agent.name).join(', ') || '(none)'
      throw new Error(`No teammate named "${to}". Teammates: ${names}`)
    }

    const text =
      `[Team message from ${me.agent.name}] ${message.replace(/\s*\r?\n\s*/g, ' ')} ` +
      `(Reply with the send_team_message tool if a reply is needed.)`
    const delivered: string[] = []
    const skipped: string[] = []
    for (const r of targets) {
      // Offene Rückfrage an den Nutzer: Eingabe würde die Auswahl beantworten → nicht zustellen
      if (r.agent.status === 'needsInput' && r.agent.statusMessage === 'Stellt eine Frage') {
        skipped.push(r.agent.name)
        continue
      }
      if (r.agent.status === 'starting') r.pending.push(text)
      else await this.sendLine(r.agent.id, text)
      delivered.push(r.agent.name)
    }
    if (process.env.DEVHUB_DEBUG)
      console.log('[DevHub] Team-Nachricht', me.agent.name, '→', delivered.join(', '))
    return [
      delivered.length ? `Delivered to ${delivered.join(', ')}.` : '',
      skipped.length
        ? `Not delivered to ${skipped.join(', ')}: waiting for the user to answer a question – try again later.`
        : ''
    ]
      .filter(Boolean)
      .join(' ')
  }

  /** Team-Infos für den System-Prompt (Name, Leitung, Kollegen, gemeinsame Richtlinien). */
  private teamContext(agent: Agent): TeamContext | undefined {
    const state = getState()
    const team = state.teams.find((t) => t.id === agent.teamId)
    if (!team) return undefined
    const members = state.agents
      .filter((a) => a.teamId === team.id)
      .sort((a, b) => a.createdAt - b.createdAt)
    const role = (templateId?: string): string =>
      state.templates.find((t) => t.id === templateId)?.name ?? 'general agent'
    return {
      name: team.name,
      lead: members[0]?.name ?? agent.name,
      teammates: members
        .filter((a) => a.id !== agent.id)
        .map((a) => `${a.name} (role: ${role(a.templateId)})`),
      instructions: state.teamTemplates.find((t) => t.id === team.teamTemplateId)?.instructions
    }
  }

  private handleShowCode(agentId: string, args: ShowCodeArgs): string {
    const r = this.running.get(agentId)
    if (!r) throw new Error('Unknown agent')
    if (!args.file_path || !args.start_line)
      throw new Error('file_path and start_line are required')
    const cwd = getState().projects.find((p) => p.id === r.agent.projectId)?.agentPath ?? ''
    const filePath = isAbsolute(args.file_path) ? args.file_path : resolvePath(cwd, args.file_path)
    if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`)

    const start = Math.max(1, Math.floor(args.start_line))
    const end = Math.max(start, Math.floor(args.end_line ?? start))
    this.events.onCodeFocus({
      agentId,
      filePath,
      startLine: start,
      endLine: end,
      note: args.note,
      at: Date.now()
    })
    return `Shown to the user: ${filePath} lines ${start}-${end}`
  }

  private setStatus(id: string, status: AgentStatus, message?: string): void {
    const r = this.running.get(id)
    if (!r) return
    if (r.agent.status === status && r.agent.statusMessage === message) return
    r.agent.status = status
    r.agent.statusMessage = message
    // Wartezustand speichern, damit er nach einem App-Neustart wieder angezeigt wird
    // (nur schreiben, wenn er sich ändert – working/idle wechseln häufig)
    const needsInput = status === 'needsInput' ? (message ?? '') : undefined
    const saved = getState().agents.find((x) => x.id === id)
    if (saved && saved.needsInput !== needsInput) {
      updateState(() => (saved.needsInput = needsInput))
    }
    // TUI ist bereit → zurückgehaltene Team-Nachrichten zustellen
    if (status !== 'starting' && r.pending.length) {
      const queued = r.pending.splice(0)
      void (async () => {
        for (const text of queued) await this.sendLine(id, text).catch(() => {})
      })()
    }
    this.emitChanged()
  }

  private forget(id: string): void {
    updateState((s) => (s.agents = s.agents.filter((a) => a.id !== id)))
    try {
      rmSync(join(dataDir('agents'), id), { recursive: true, force: true })
    } catch {
      // ignorieren
    }
    this.removeEmptyTeams()
    this.emitChanged()
  }

  /** Teams ohne (gespeicherte) Agents entfernen – ein Team endet mit seinem letzten Mitglied. */
  private removeEmptyTeams(): void {
    const { teams, agents } = getState()
    const used = new Set(agents.map((a) => a.teamId).filter(Boolean))
    if (teams.some((t) => !used.has(t.id))) {
      updateState((s) => (s.teams = s.teams.filter((t) => used.has(t.id))))
    }
  }

  /** Eindeutiger Teamname: „Feature“, „Feature 2“ … bzw. „Team 1“, „Team 2“ … */
  private nextTeamName(base?: string): string {
    const names = new Set(getState().teams.map((t) => t.name.toLowerCase()))
    if (base) {
      if (!names.has(base.toLowerCase())) return base
      let n = 2
      while (names.has(`${base} ${n}`.toLowerCase())) n++
      return `${base} ${n}`
    }
    let n = 1
    while (names.has(`team ${n}`)) n++
    return `Team ${n}`
  }

  /**
   * Eindeutiger Name über alle Agents (für die Sprachsteuerung):
   * ohne Vorlage „Agent N“ (kleinste freie Nummer), mit Vorlage „Entwickler“, dann „Entwickler 2“ …
   */
  private nextName(base?: string): string {
    const names = new Set(getState().agents.map((a) => a.name.toLowerCase()))
    if (base) {
      if (!names.has(base.toLowerCase())) return base
      let n = 2
      while (names.has(`${base} ${n}`.toLowerCase())) n++
      return `${base} ${n}`
    }
    let n = 1
    while (names.has(`agent ${n}`)) n++
    return `Agent ${n}`
  }

  private emitChanged(): void {
    this.events.onChanged(this.list(), this.teams())
  }
}

interface TeamContext {
  name: string
  /** Name des leitenden Agents (erstes Mitglied) */
  lead: string
  /** „Reviewer (role: Reviewer)“ … */
  teammates: string[]
  instructions?: string
}

function persisted(a: Agent): PersistedAgent {
  return {
    id: a.id,
    projectId: a.projectId,
    name: a.name,
    sessionId: a.sessionId,
    createdAt: a.createdAt,
    voiceAutoSend: a.voiceAutoSend,
    model: a.model,
    templateId: a.templateId,
    teamId: a.teamId
  }
}

/** DevHub-Hinweis + ggf. Rolle/Richtlinien aus der Vorlage + ggf. Team-Kontext. */
function systemPrompt(
  agentName: string,
  instructions: string | undefined,
  team: TeamContext | undefined
): string {
  const parts = [SYSTEM_HINT]
  const text = instructions?.trim()
  if (text || team) parts.push(`Your name in DevHub is "${agentName}".`)
  if (text) {
    parts.push(
      'The user configured the following role and guidelines for you (they may be written in ' +
        'another language; follow them, and keep answering in the language the user writes to you):\n\n' +
        text
    )
  }
  if (team) {
    const lead = team.lead === agentName
    parts.push(
      [
        `You are a member of the DevHub team "${team.name}" working on the same project.`,
        `Teammates: ${team.teammates.join(', ') || '(none)'}.`,
        lead
          ? "You lead the team: when you get a task, plan it, split it into parts that fit your teammates' roles and hand them over with the `send_team_message` tool; collect their results and report back to the user."
          : `${team.lead} leads the team. Wait for tasks from the user or your teammates; when you finish a handed-over task, report the result to whoever sent it.`,
        'Communicate with teammates only via the `send_team_message` tool (see `team_members` for names and status). ' +
          'Messages from teammates arrive in your terminal prefixed with "[Team message from <name>]". ' +
          'Keep messages concise and self-contained; do not send pure acknowledgements. ' +
          'You share one working directory: coordinate before editing the same files.',
        team.instructions?.trim()
          ? `Team guidelines from the user (follow them):\n\n${team.instructions.trim()}`
          : ''
      ]
        .filter(Boolean)
        .join('\n')
    )
  }
  return parts.join('\n\n')
}

/** Letzte Zeilen der Ausgabe ohne Terminal-Steuersequenzen (für Fehlermeldungen). */
function lastLines(output: string, count = 6): string {
  return output
    .replace(ANSI, '')
    .split(/\r?\n|\r/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-count)
    .join('\n')
}

/** CSI-, OSC- und einfache ESC-Sequenzen */
const ANSI =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>]/g

/** Gibt es zu der Session schon ein Transkript? Nur dann ist --resume möglich. */
function sessionExists(sessionId: string): boolean {
  const base = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
  try {
    return readdirSync(base).some((dir) => existsSync(join(base, dir, `${sessionId}.jsonl`)))
  } catch {
    return false
  }
}
