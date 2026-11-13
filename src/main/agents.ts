import * as pty from 'node-pty'
import { randomUUID } from 'crypto'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, resolve as resolvePath } from 'path'
import type {
  Agent,
  AgentStatus,
  CodeFocus,
  CodeSnippet,
  EditedFile,
  Team,
  TeamMember
} from '../shared/types'
import { isTeamWorker, teamLead } from '../shared/types'
import { editFromToolResult, mergeEdits, mergeSnippets, TranscriptReader } from './snippets'
import {
  AgentBridge,
  AnswerPermissionArgs,
  HookEvent,
  PermissionDecision,
  ShowCodeArgs,
  TeamMessageArgs,
  ToolName
} from './agentBridge'
import { applyOrder, dataDir, getState, updateState, type PersistedAgent } from './store'
import { claudeEnv, resolveClaude } from './tools'
import { isValidModelName, mergeAgentArgs } from '../shared/agentArgs'

/** Passed to every agent via --append-system-prompt. */
const SYSTEM_HINT =
  'You are running inside DevHub, a desktop app that shows your terminal next to a code panel. ' +
  'Whenever you analyze code, investigate a problem or find a bug, call the `show_code` tool of the ' +
  '`devhub` MCP server with the affected file and line range so the user sees the spot highlighted. ' +
  'Call it again whenever your focus moves to another location.'

const MAX_BUFFER = 200_000
/** If an agent fails this quickly, the start itself was broken (e.g. unknown start flag). */
const EARLY_EXIT_MS = 8000
/** Upper limit for team size (each agent is its own claude process) */
const MAX_TEAM_SIZE = 8

interface RunningAgent {
  agent: Agent
  proc: pty.IPty
  buffer: string
  startedAt: number
  /** Stopped via the list/app (not a start failure) */
  stopping: boolean
  /** Team messages that arrived before the first output (TUI not ready yet) */
  pending: string[]
  /** Session transcript (path from the hook events), source of the snippets */
  transcript?: TranscriptReader
  /** Code blocks from the responses, newest first */
  snippets: CodeSnippet[]
  /** Files edited by the agent (order = first edit) */
  edits: EditedFile[]
  /** Worker: has reported to the orchestrator since the last prompt */
  reported: boolean
}

/** A worker's open permission request (claude is waiting for the hook response) */
interface PermissionRequest {
  workerId: string
  finish: (decision: PermissionDecision | null) => void
}

/** Name of the automatically started orchestrator ("Orchestrator", "Orchestrator 2" …) */
const ORCHESTRATOR_NAME = 'Orchestrator'
/** Status text of a worker while its permission request is open */
const WAITING_FOR_PERMISSION = 'Wartet auf Freigabe durch den Orchestrator'

export interface StartTeamOptions {
  /** Team template – or a free member list (temporary team) */
  teamTemplateId?: string
  members?: TeamMember[]
  /** Name for temporary teams; defaults to "Team N" */
  name?: string
  /** Task for the orchestrator */
  task?: string
  /** Model for all members (named by voice), takes precedence over the templates */
  model?: string
}

export interface AgentEvents {
  onData: (id: string, data: string) => void
  onChanged: (agents: Agent[], teams: Team[]) => void
  onCodeFocus: (focus: CodeFocus) => void
  /** An agent's snippet list has changed (complete, newest first) */
  onSnippets: (agentId: string, snippets: CodeSnippet[]) => void
  /** An agent's list of edited files has changed (complete) */
  onEdits: (agentId: string, files: EditedFile[]) => void
  /** Agent exited with an error right after starting */
  onStartFailed: (agentName: string, output: string) => void
  /** Ctrl+G: open the editor tab, prefilled with the current prompt */
  onEditorOpened: (agentId: string, text: string) => void
  /** Append text (e.g. a voice command) to the open editor tab instead of the terminal */
  onEditorAppend: (agentId: string, text: string) => void
}

/** Open Ctrl+G edit: claude waits until `done` is called */
interface EditorSession {
  filePath: string
  text: string
  done: () => void
}

/** Name of the Ctrl+G "editor" (wrapper script); must contain "notepad", see writeAgentConfig */
const EDITOR_NAME = 'devhub-notepad'

/** Delay after closing the editor until claude has reloaded the prompt */
const EDITOR_RELOAD_MS = 500
/** Maximum time a worker waits for the orchestrator's decision (seconds) */
const PERMISSION_TIMEOUT_S = 24 * 60 * 60

export class AgentManager {
  private running = new Map<string, RunningAgent>()
  private bridge: AgentBridge
  private quitting = false
  /** Restore only once per app start */
  private restored = false
  private editors = new Map<string, EditorSession>()
  private permissions = new Map<number, PermissionRequest>()
  private nextPermissionId = 1

  constructor(private events: AgentEvents) {
    this.bridge = new AgentBridge({
      onHook: (id, ev) => this.handleHook(id, ev),
      tools: (id) => {
        const a = this.running.get(id)?.agent
        if (!a?.teamId) return ['show_code']
        const team: ToolName[] = ['show_code', 'team_members', 'send_team_message']
        return a.teamRole === 'orchestrator' ? [...team, 'answer_permission'] : team
      },
      onToolCall: (id, name, args) => this.handleToolCall(id, name, args),
      onEditor: (id, filePath) => this.openEditor(id, filePath),
      onEditorAbort: (id) => this.closeEditor(id),
      onPermission: (id, ev, signal) => this.requestPermission(id, ev, signal)
    })
  }

  // ------------------------------------------------------------ Ctrl+G editor tab

  /** claude has launched the "editor" for the prompt file → open the tab, wait until it closes. */
  private openEditor(agentId: string, filePath: string): Promise<void> {
    const r = this.running.get(agentId)
    if (!r || !filePath || !existsSync(filePath)) return Promise.resolve()
    this.editors.get(agentId)?.done() // Release the previous (hanging) session
    const text = readFileSync(filePath, 'utf8')
    return new Promise((done) => {
      this.editors.set(agentId, { filePath, text, done })
      r.agent.editing = true
      this.events.onEditorOpened(agentId, text)
      this.emitChanged()
    })
  }

  /** Initial text of an open editor tab (e.g. after reloading the UI) */
  editorText(agentId: string): string | null {
    return this.editors.get(agentId)?.text ?? null
  }

  /**
   * Close the editor tab. `text`: new prompt (null = leave unchanged);
   * `submit`: submit it afterwards. Only then is the agent usable again.
   */
  finishEditor(agentId: string, text: string | null, submit: boolean): void {
    const s = this.editors.get(agentId)
    if (!s) return
    if (text !== null) writeFileSync(s.filePath, text.replace(/\r\n/g, '\n'), 'utf8')
    this.closeEditor(agentId)
    const r = this.running.get(agentId)
    if (!r) return
    setTimeout(() => {
      if (submit && this.running.get(agentId) === r) r.proc.write('\r')
      // Deliver team messages that arrived in the meantime
      setTimeout(() => this.flushPending(agentId), submit ? 1000 : 0)
    }, EDITOR_RELOAD_MS)
  }

  /** End the editor session (claude gets the response and rereads the file). */
  private closeEditor(agentId: string): void {
    const s = this.editors.get(agentId)
    if (!s) return
    this.editors.delete(agentId)
    s.done()
    const r = this.running.get(agentId)
    if (r) r.agent.editing = false
    this.emitChanged()
  }

  /** Save a clipboard image for the prompt; returns the path */
  saveEditorImage(agentId: string, ext: string, data: ArrayBuffer): string {
    if (!this.running.has(agentId)) throw new Error('Agent läuft nicht mehr')
    const safeExt = /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toLowerCase() : 'png'
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const file = join(
      dataDir('agents', agentId, 'images'),
      `bild-${stamp}-${randomUUID().slice(0, 4)}.${safeExt}`
    )
    writeFileSync(file, Buffer.from(data))
    return file
  }

  init(): Promise<void> {
    return this.bridge.start()
  }

  /** Running agents in the saved order (set by the user via drag & drop). */
  list(): Agent[] {
    const order = new Map(getState().agents.map((a, i) => [a.id, i]))
    const pos = (id: string): number => order.get(id) ?? Number.MAX_SAFE_INTEGER
    return [...this.running.values()].map((r) => r.agent).sort((a, b) => pos(a.id) - pos(b.id))
  }

  /** New order for a group of agents (project or team); all others keep their place. */
  reorder(ids: string[]): void {
    updateState((s) => (s.agents = applyOrder(s.agents, ids)))
    this.emitChanged()
  }

  /** Running teams */
  teams(): Team[] {
    return getState().teams
  }

  buffer(id: string): string {
    return this.running.get(id)?.buffer ?? ''
  }

  /** Starts all agents that were still running when the app was last closed. */
  async restore(): Promise<void> {
    if (this.restored) return
    this.restored = true
    const projects = new Set(getState().projects.map((p) => p.id))
    for (const saved of getState().agents) {
      if (this.running.has(saved.id)) continue
      if (!projects.has(saved.projectId)) continue
      try {
        // If the agent was waiting for input at shutdown, it stays highlighted until it continues
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
   * Starts a team: an automatic orchestrator + the members as workers, all sharing one
   * teamId. All agents are saved first (names reserved, each knows its teammates at start),
   * then started. The orchestrator gets the task and distributes it; workers can only be
   * observed by the user.
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
    // Consecutive timestamps: order stays unambiguous, even after a restart
    const base = Date.now()
    const orchestrator: Agent = {
      id: randomUUID(),
      projectId,
      name: this.nextName(ORCHESTRATOR_NAME),
      sessionId: randomUUID(),
      status: 'starting',
      createdAt: base,
      model,
      teamId: team.id,
      teamRole: 'orchestrator'
    }
    updateState((s) => s.agents.push(persisted(orchestrator)))
    agents.push(orchestrator)
    for (const [i, m] of members.entries()) {
      const template = m.templateId ? state.templates.find((t) => t.id === m.templateId) : undefined
      const agent: Agent = {
        id: randomUUID(),
        projectId,
        name: this.nextName(template?.name),
        sessionId: randomUUID(),
        status: 'starting',
        createdAt: base + 1 + i,
        model,
        templateId: template?.id,
        teamId: team.id,
        teamRole: 'worker'
      }
      updateState((s) => s.agents.push(persisted(agent)))
      agents.push(agent)
    }

    const failures: string[] = []
    for (const agent of agents) {
      try {
        await this.spawn(agent, agent === orchestrator ? opts.task?.trim() || undefined : undefined)
      } catch (e) {
        failures.push(`${agent.name}: ${e instanceof Error ? e.message : String(e)}`)
        updateState((s) => (s.agents = s.agents.filter((a) => a.id !== agent.id)))
        // Without an orchestrator the team cannot be controlled → abort entirely
        if (agent === orchestrator) {
          const ids = new Set(agents.map((a) => a.id))
          updateState((s) => (s.agents = s.agents.filter((a) => !ids.has(a.id))))
          this.removeEmptyTeams()
          this.emitChanged()
          throw new Error(failures.join('\n'), { cause: e })
        }
      }
    }
    this.removeEmptyTeams()
    this.emitChanged()
    // Not a single worker is running → an orchestrator alone is pointless
    if (failures.length === agents.length - 1) {
      this.stopTeam(team.id)
      throw new Error(failures.join('\n'))
    }
    return team
  }

  /** Stops all agents of a team (the team disappears with its last agent). */
  stopTeam(teamId: string): void {
    for (const a of getState().agents.filter((x) => x.teamId === teamId)) this.kill(a.id)
  }

  /**
   * model: overrides `--model` from the template and start flags (e.g. named via voice command).
   * templateId: template → name "<template>" / "<template> 2" …, the template's model and instructions.
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
    // Save first (reserves the name), then start
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

  /** Stop via the UI: workers only together with the whole team, the orchestrator stops the team. */
  stop(id: string): void {
    const a = this.running.get(id)?.agent
    if (a && isTeamWorker(a)) {
      throw new Error(
        `${a.name} gehört zu einem Team – beende das Team oder bitte den Orchestrator`
      )
    }
    if (a?.teamId && a.teamRole === 'orchestrator') return this.stopTeam(a.teamId)
    this.kill(id)
  }

  private kill(id: string): void {
    const r = this.running.get(id)
    if (!r) return this.forget(id)
    r.stopping = true
    r.proc.kill()
  }

  rename(id: string, name: string): void {
    const r = this.running.get(id)
    const trimmed = name.trim()
    if (!r || !trimmed) return
    if (isTeamWorker(r.agent)) throw new Error('Teammitglieder können nicht umbenannt werden')
    r.agent.name = trimmed
    updateState((s) => {
      const a = s.agents.find((x) => x.id === id)
      if (a) a.name = trimmed
    })
    this.emitChanged()
  }

  /** Voice auto-send per agent: true/false overrides the global setting, undefined = global. */
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

  /** Pass recognized speech text to the agent – submit it or just type it in. true = submitted. */
  async sendVoice(id: string, text: string): Promise<boolean> {
    let r = this.running.get(id)
    if (!r) throw new Error('Agent läuft nicht mehr')
    // Workers can only be observed → the instruction goes to their orchestrator
    if (isTeamWorker(r.agent)) {
      const lead = this.leadOf(r.agent)
      if (!lead) throw new Error(`${r.agent.name} hat keinen laufenden Orchestrator`)
      text = `[Message from the user about ${r.agent.name}] ${text}`
      r = lead
      id = lead.agent.id
    }
    // Editor tab open: insert the text there (the agent itself is locked)
    if (r.agent.editing) {
      this.events.onEditorAppend(id, text)
      return false
    }
    const autoSend = r.agent.voiceAutoSend ?? getState().settings.voiceAutoSend
    if (autoSend) await this.typeLine(id, text)
    else r.proc.write(text.replace(/\r?\n/g, ' '))
    return autoSend
  }

  /** Keyboard input from the terminal; editor tab open or worker → locked */
  write(id: string, data: string): void {
    const r = this.running.get(id)
    if (r && !r.agent.editing && !isTeamWorker(r.agent)) r.proc.write(data)
  }

  /** Line from the user (e.g. `/clear`) – not to workers, they can only be observed. */
  async sendLine(id: string, text: string): Promise<void> {
    const a = this.running.get(id)?.agent
    if (a && isTeamWorker(a)) {
      throw new Error(
        `${a.name} kann nur beobachtet werden – Anweisungen gehen an den Orchestrator`
      )
    }
    return this.typeLine(id, text)
  }

  /** Types text and submits it. Enter is sent separately so the TUI does not treat it as part of a paste. */
  private async typeLine(id: string, text: string): Promise<void> {
    const r = this.running.get(id)
    if (!r) throw new Error('Agent läuft nicht')
    if (r.agent.editing) throw new Error(`${r.agent.name} wird gerade im Editor-Tab bearbeitet`)
    r.proc.write(text.replace(/\r?\n/g, ' '))
    await new Promise((res) => setTimeout(res, 150))
    r.proc.write('\r')
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols < 2 || rows < 2) return
    try {
      this.running.get(id)?.proc.resize(Math.floor(cols), Math.floor(rows))
    } catch {
      // Process already exited
    }
  }

  /** On app quit: stop the processes but keep the saved agents (for restore). */
  shutdown(): void {
    this.quitting = true
    for (const r of this.running.values()) {
      try {
        r.proc.kill()
      } catch {
        // ignore
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

    const { settingsFile, mcpFile, binDir } = this.writeAgentConfig(agent)
    // Read the template fresh on every start → changes also apply on restore
    const template = agent.templateId
      ? getState().templates.find((t) => t.id === agent.templateId)
      : undefined
    // Model: named by voice > template > start flags (project > global)
    const model = agent.model || template?.model
    // User flags first: a DevHub flag then terminates any variadic values (e.g. --allowedTools a b),
    // and the task is always preceded by --append-system-prompt <value> (task stays positional)
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

    // Start claude.exe directly; a .cmd wrapper needs cmd.exe (no special characters and
    // no line breaks allowed there)
    const isExe = claude.toLowerCase().endsWith('.exe')
    const file = isExe ? claude : 'cmd.exe'
    const argv = isExe
      ? args
      : [
          '/c',
          claude,
          ...args.map((a) => a.replace(/["%^&|<>]/g, ' ').replace(/\s*\r?\n\s*/g, ' '))
        ]

    // Ctrl+G ("edit in editor"): claude runs `$EDITOR "<prompt-file>"` via cmd and
    // waits. EDITOR is the wrapper from writeAgentConfig, found via PATH (avoids problems with
    // spaces in the path: claude splits EDITOR at spaces).
    const env = claudeEnv({ FORCE_COLOR: '1', EDITOR: EDITOR_NAME, VISUAL: EDITOR_NAME })
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
    env[pathKey] = `${binDir};${env[pathKey] ?? ''}`
    const proc = pty.spawn(file, argv, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: project.agentPath,
      env
    })

    if (process.env.DEVHUB_DEBUG)
      console.log('[DevHub] Agent gestartet', agent.name, file, argv.join(' '))
    const r: RunningAgent = {
      agent,
      proc,
      buffer: '',
      startedAt: Date.now(),
      stopping: false,
      pending: [],
      snippets: [],
      edits: [],
      reported: false
    }
    this.running.set(agent.id, r)

    proc.onData((data) => {
      r.buffer = (r.buffer + data).slice(-MAX_BUFFER)
      if (agent.status === 'starting') this.setStatus(agent.id, 'idle')
      this.events.onData(agent.id, data)
    })

    proc.onExit(({ exitCode }) => {
      this.running.delete(agent.id)
      // Open editor tab: answer the request so an orphaned curl process exits
      this.closeEditor(agent.id)
      if (this.quitting) return
      if (!r.stopping && exitCode !== 0 && Date.now() - r.startedAt < EARLY_EXIT_MS) {
        this.events.onStartFailed(agent.name, lastLines(r.buffer))
      }
      // Agent was stopped in the terminal or via the list → remove the entry
      this.forget(agent.id)
      // Without an orchestrator the team can no longer be controlled → stop the workers too
      if (agent.teamId && agent.teamRole === 'orchestrator') this.stopTeam(agent.teamId)
    })
  }

  /**
   * Per agent: hooks (report status to the app) + MCP config (show_code). Workers additionally:
   * permission requests go to the orchestrator (PermissionRequest hook waits for its answer),
   * no questions to the user (AskUserQuestion denied – the user cannot answer them).
   */
  private writeAgentConfig(agent: Agent): {
    settingsFile: string
    mcpFile: string
    binDir: string
  } {
    const agentId = agent.id
    const worker = isTeamWorker(agent)
    const dir = dataDir('agents', agentId)
    // curl.exe ships with Windows 10 and later; ".exe" is explicit because "curl" is an alias in PowerShell 5.1
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
        Stop: [{ hooks: hook }],
        // No -m: the request stays open until the orchestrator has decided (output = response)
        ...(worker && {
          PermissionRequest: [
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command: `curl.exe -s -X POST -H "Content-Type: application/json" --data-binary @- ${this.bridge.permissionUrl(agentId)}`,
                  timeout: PERMISSION_TIMEOUT_S
                }
              ]
            }
          ]
        })
      },
      permissions: {
        allow: [
          'mcp__devhub__show_code',
          'mcp__devhub__team_members',
          'mcp__devhub__send_team_message',
          'mcp__devhub__answer_permission'
        ],
        ...(worker && { deny: ['AskUserQuestion'] })
      }
    }
    const mcp = { mcpServers: { devhub: { type: 'http', url: this.bridge.mcpUrl(agentId) } } }

    const settingsFile = join(dir, 'settings.json')
    const mcpFile = join(dir, 'mcp.json')
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2))
    writeFileSync(mcpFile, JSON.stringify(mcp, null, 2))

    // Ctrl+G "editor": sends the prompt file path to DevHub and blocks until the editor tab
    // is closed. The name contains "notepad" so claude treats it as a GUI editor: the UI stays
    // in place and the input field shows "Save and close editor to continue…"
    // (with unknown names claude assumes a terminal editor and clears the screen).
    const binDir = dataDir('agents', agentId, 'bin')
    writeFileSync(
      join(binDir, `${EDITOR_NAME}.cmd`),
      `@curl.exe -s -o NUL -X POST ${this.bridge.editorUrl(agentId)} --data-binary "%~1"\r\n`
    )
    return { settingsFile, mcpFile, binDir }
  }

  private handleHook(agentId: string, ev: HookEvent): void {
    if (process.env.DEVHUB_DEBUG) {
      console.log('[DevHub] Hook', agentId.slice(0, 8), ev.hook_event_name, ev.tool_name ?? '')
    }
    // Every hook event names the transcript; read snippets when the agent has said something
    if (typeof ev.transcript_path === 'string') this.useTranscript(agentId, ev.transcript_path)
    if (
      ev.hook_event_name === 'SessionStart' ||
      ev.hook_event_name === 'Stop' ||
      ev.hook_event_name === 'Notification' ||
      (ev.hook_event_name === 'PreToolUse' && ev.tool_name === 'AskUserQuestion')
    ) {
      this.readSnippets(agentId)
      // In case the last response is not yet in the transcript when the hook fires: retry shortly after
      if (ev.hook_event_name === 'Stop') setTimeout(() => this.readSnippets(agentId), 1500)
    }
    const r = this.running.get(agentId)
    // Workers never wait for the user (the user cannot answer them): done = idle
    if (r && isTeamWorker(r.agent)) {
      switch (ev.hook_event_name) {
        case 'UserPromptSubmit':
          r.reported = false
          this.setStatus(agentId, 'working')
          return
        case 'Stop':
          this.setStatus(agentId, 'idle', 'Fertig')
          if (!r.reported) {
            const lead = this.leadOf(r.agent)
            if (lead) {
              this.deliver(
                lead,
                `[Team status] ${r.agent.name} finished its turn without sending you a report. ` +
                  'Ask it with send_team_message if you need its result.'
              )
            }
            r.reported = true // remind only once per assignment
          }
          return
        case 'Notification':
          return
      }
    }
    switch (ev.hook_event_name) {
      case 'SessionStart':
        // On resume (restore), keep the saved waiting state
        if (ev.source === 'resume' && this.running.get(agentId)?.agent.status === 'needsInput')
          break
        this.setStatus(agentId, 'idle')
        break
      case 'PostToolUse': {
        // Edit/Write/MultiEdit: show the file as a tab on the right right away
        const edit = editFromToolResult(agentId, ev.tool_response, Date.now())
        if (edit) this.addEdits(agentId, [edit])
        // An open permission request (worker) stays visible until the orchestrator has decided
        if (r?.agent.statusMessage !== WAITING_FOR_PERMISSION) this.setStatus(agentId, 'working')
        break
      }
      case 'UserPromptSubmit':
        this.setStatus(agentId, 'working')
        break
      case 'PreToolUse':
        // AskUserQuestion waits for the user, all other tools = work
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

  /** Snippets of all running agents (for the UI after a reload) */
  snippets(): Record<string, CodeSnippet[]> {
    return Object.fromEntries([...this.running].map(([id, r]) => [id, r.snippets]))
  }

  /** Edited files of all running agents (for the UI after a reload) */
  edits(): Record<string, EditedFile[]> {
    return Object.fromEntries([...this.running].map(([id, r]) => [id, r.edits]))
  }

  private addEdits(agentId: string, added: EditedFile[]): void {
    const r = this.running.get(agentId)
    if (!r || !added.length) return
    const merged = mergeEdits(r.edits, added)
    // The transcript repeats what the hook already reported → only emit on a real change
    if (merged.length === r.edits.length && merged.every((e, i) => e === r.edits[i])) return
    r.edits = merged
    this.events.onEdits(agentId, r.edits)
  }

  private useTranscript(agentId: string, path: string): void {
    const r = this.running.get(agentId)
    if (r && r.transcript?.path !== path) r.transcript = new TranscriptReader(path, agentId)
  }

  /** Pick up new code blocks from the transcript and emit them. */
  private readSnippets(agentId: string): void {
    const reader = this.running.get(agentId)?.transcript
    if (!reader) return
    reader
      .read()
      .then(({ snippets, edits }) => {
        const r = this.running.get(agentId)
        if (!r || r.transcript !== reader) return
        // After a restore, the edited files come from the transcript
        this.addEdits(agentId, edits)
        if (!snippets.length) return
        r.snippets = mergeSnippets(r.snippets, snippets)
        this.events.onSnippets(agentId, r.snippets)
      })
      .catch((e) => console.error('[DevHub] Transkript nicht lesbar:', e))
  }

  private async handleToolCall(
    agentId: string,
    name: ToolName,
    args: Record<string, unknown>
  ): Promise<string> {
    if (name === 'show_code') return this.handleShowCode(agentId, args as unknown as ShowCodeArgs)
    if (name === 'team_members') return this.handleTeamMembers(agentId)
    if (name === 'answer_permission')
      return this.handleAnswerPermission(agentId, args as unknown as AnswerPermissionArgs)
    return this.handleTeamMessage(agentId, args as unknown as TeamMessageArgs)
  }

  /** The team's orchestrator (or the lead of older teams), if it is running */
  private leadOf(agent: Agent): RunningAgent | undefined {
    if (!agent.teamId) return undefined
    const lead = teamLead(this.list(), agent.teamId)
    return lead && lead.id !== agent.id ? this.running.get(lead.id) : undefined
  }

  /**
   * A worker's PermissionRequest: forward it to the orchestrator and wait for its decision
   * (`answer_permission`). If the connection drops (worker exited), the request expires.
   */
  private requestPermission(
    workerId: string,
    ev: HookEvent,
    signal: AbortSignal
  ): Promise<PermissionDecision | null> {
    const worker = this.running.get(workerId)
    if (!worker || !isTeamWorker(worker.agent)) return Promise.resolve(null)
    const lead = this.leadOf(worker.agent)
    if (!lead) {
      return Promise.resolve({
        behavior: 'deny',
        message: 'No orchestrator is running for your team, so nobody can approve this.'
      })
    }
    const id = this.nextPermissionId++
    const input = JSON.stringify(ev.tool_input ?? {})
    const summary = input.length > 600 ? input.slice(0, 600) + ' …' : input
    this.setStatus(workerId, 'needsInput', WAITING_FOR_PERMISSION)
    return new Promise((resolve) => {
      const finish = (decision: PermissionDecision | null): void => {
        if (!this.permissions.delete(id)) return
        signal.removeEventListener('abort', onAbort)
        if (this.running.get(workerId)?.agent.statusMessage === WAITING_FOR_PERMISSION) {
          this.setStatus(workerId, 'working')
        }
        resolve(decision)
      }
      const onAbort = (): void => finish(null)
      this.permissions.set(id, { workerId, finish })
      signal.addEventListener('abort', onAbort)
      this.deliver(
        lead,
        `[Permission request #${id} from ${worker.agent.name}] wants to use the tool ` +
          `${String(ev.tool_name ?? '?')} with input ${summary}. ` +
          `It is blocked until you answer with the answer_permission tool (request_id ${id}).`
      )
    })
  }

  private handleAnswerPermission(agentId: string, args: AnswerPermissionArgs): string {
    const me = this.running.get(agentId)?.agent
    if (me?.teamRole !== 'orchestrator') throw new Error('Only the team orchestrator can do this')
    const id = Math.floor(Number(args.request_id))
    const req = this.permissions.get(id)
    const worker = req && this.running.get(req.workerId)?.agent
    if (!req || !worker) throw new Error(`No open permission request #${id}`)
    if (worker.teamId !== me.teamId) throw new Error('This request is not from your team')
    if (args.decision === 'allow') {
      req.finish({ behavior: 'allow' })
      return `Allowed request #${id} – ${worker.name} continues.`
    }
    if (args.decision !== 'deny') throw new Error('decision must be "allow" or "deny"')
    req.finish({
      behavior: 'deny',
      message: `Denied by ${me.name}: ${String(args.message ?? '').trim() || 'not allowed'}`
    })
    return `Denied request #${id} – ${worker.name} was told why.`
  }

  /**
   * Pass text to an agent as a new prompt – hold it back while the agent is not ready
   * (starting, editor tab open, open question to the user that the input would answer).
   */
  private deliver(r: RunningAgent, text: string): void {
    if (this.mustHold(r)) r.pending.push(text)
    else void this.typeLine(r.agent.id, text).catch(() => r.pending.push(text))
  }

  private mustHold(r: RunningAgent): boolean {
    return (
      r.agent.status === 'starting' ||
      !!r.agent.editing ||
      (r.agent.status === 'needsInput' && r.agent.statusMessage === 'Stellt eine Frage')
    )
  }

  /** An agent's teammates (excluding itself), running or still starting. */
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
      a.teamRole === 'orchestrator'
        ? 'orchestrator'
        : (getState().templates.find((t) => t.id === a.templateId)?.name ?? 'general agent')
    const lead = isTeamWorker(me.agent) ? this.leadOf(me.agent) : undefined
    return [
      `Team "${team.name}" – your teammates:`,
      ...(lead ? [`(You can only message your orchestrator ${lead.agent.name}.)`] : []),
      ...mates.map(
        (r) =>
          `- ${r.agent.name} (role: ${role(r.agent)}, status: ${r.agent.status}` +
          `${r.agent.statusMessage ? ` – ${r.agent.statusMessage}` : ''})`
      )
    ].join('\n')
  }

  /**
   * Message to teammates: typed into their terminal as a new prompt (Claude Code queues it
   * if the agent is busy). Only within the team.
   */
  private async handleTeamMessage(agentId: string, args: TeamMessageArgs): Promise<string> {
    const me = this.running.get(agentId)
    if (!me?.agent.teamId) throw new Error('You are not part of a team')
    const message = String(args.message ?? '').trim()
    const to = String(args.to ?? '').trim()
    if (!message || !to) throw new Error('"to" and "message" are required')

    // Workers talk only to the orchestrator (it distributes and collects everything)
    const lead = isTeamWorker(me.agent) ? this.leadOf(me.agent) : undefined
    if (isTeamWorker(me.agent) && !lead) throw new Error('Your orchestrator is not running')
    const mates = lead ? [lead] : this.teammates(agentId)
    const targets =
      to.toLowerCase() === 'all'
        ? mates
        : mates.filter((r) => r.agent.name.toLowerCase() === to.toLowerCase())
    if (targets.length === 0) {
      const names = mates.map((r) => r.agent.name).join(', ') || '(none)'
      throw new Error(
        lead
          ? `You can only message your orchestrator ${lead.agent.name}.`
          : `No teammate named "${to}". Teammates: ${names}`
      )
    }
    if (lead) me.reported = true

    const text =
      `[Team message from ${me.agent.name}] ${message.replace(/\s*\r?\n\s*/g, ' ')} ` +
      `(Reply with the send_team_message tool if a reply is needed.)`
    const delivered: string[] = []
    const held: string[] = []
    for (const r of targets) {
      // Not ready (starting, editor tab, open question) → delivered later
      if (this.mustHold(r)) held.push(r.agent.name)
      else delivered.push(r.agent.name)
      this.deliver(r, text)
    }
    if (process.env.DEVHUB_DEBUG)
      console.log(
        '[DevHub] Team-Nachricht',
        me.agent.name,
        '→',
        targets.map((r) => r.agent.name)
      )
    return [
      delivered.length ? `Delivered to ${delivered.join(', ')}.` : '',
      held.length ? `Queued for ${held.join(', ')} (busy with the user) – delivered later.` : ''
    ]
      .filter(Boolean)
      .join(' ')
  }

  /** Team info for the system prompt (name, lead, teammates, shared guidelines). */
  private teamContext(agent: Agent): TeamContext | undefined {
    const state = getState()
    const team = state.teams.find((t) => t.id === agent.teamId)
    if (!team) return undefined
    const members = state.agents
      .filter((a) => a.teamId === team.id)
      .sort((a, b) => a.createdAt - b.createdAt)
    const role = (templateId?: string): string =>
      state.templates.find((t) => t.id === templateId)?.name ?? 'general agent'
    const lead = teamLead(members, team.id)
    const orchestrated = lead?.teamRole === 'orchestrator'
    return {
      name: team.name,
      lead: lead?.name ?? agent.name,
      orchestrated,
      teammates: members
        .filter((a) => a.id !== agent.id && !(orchestrated && a.id === lead?.id))
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
    // Persist the waiting state so it is shown again after an app restart
    // (write only when it changes – working/idle toggle frequently)
    const needsInput = status === 'needsInput' ? (message ?? '') : undefined
    const saved = getState().agents.find((x) => x.id === id)
    if (saved && saved.needsInput !== needsInput) {
      updateState(() => (saved.needsInput = needsInput))
    }
    this.flushPending(id)
    this.emitChanged()
  }

  /** Deliver held-back team messages once the TUI is ready and no editor tab is open */
  private flushPending(id: string): void {
    const r = this.running.get(id)
    if (!r || this.mustHold(r) || !r.pending.length) return
    const queued = r.pending.splice(0)
    void (async () => {
      for (const text of queued) await this.typeLine(id, text).catch(() => {})
    })()
  }

  private forget(id: string): void {
    updateState((s) => (s.agents = s.agents.filter((a) => a.id !== id)))
    try {
      rmSync(join(dataDir('agents'), id), { recursive: true, force: true })
    } catch {
      // ignore
    }
    this.removeEmptyTeams()
    this.emitChanged()
  }

  /** Remove teams without (saved) agents – a team ends with its last member. */
  private removeEmptyTeams(): void {
    const { teams, agents } = getState()
    const used = new Set(agents.map((a) => a.teamId).filter(Boolean))
    if (teams.some((t) => !used.has(t.id))) {
      updateState((s) => (s.teams = s.teams.filter((t) => used.has(t.id))))
    }
  }

  /** Unique team name: "Feature", "Feature 2" … or "Team 1", "Team 2" … */
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
   * Name unique across all agents (for voice control):
   * without a template "Agent N" (lowest free number), with a template "Developer", then "Developer 2" …
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
  /** Name of the orchestrator (or, for older teams, of the leading first member) */
  lead: string
  /** Team with an orchestrator (otherwise an older team: first member leads, everyone talks to everyone) */
  orchestrated: boolean
  /** Remaining members (excluding the agent itself, and excluding the orchestrator in orchestrated teams) */
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
    teamId: a.teamId,
    teamRole: a.teamRole
  }
}

/** DevHub hint + role/guidelines from the template, if any + team context, if any. */
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
  if (team?.orchestrated) parts.push(orchestratedTeamPrompt(agentName, team))
  else if (team) {
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

/** Team with an orchestrator: role of the orchestrator or of a worker. */
function orchestratedTeamPrompt(agentName: string, team: TeamContext): string {
  const guidelines = team.instructions?.trim()
    ? `Team guidelines from the user (follow them):\n\n${team.instructions.trim()}`
    : ''
  if (team.lead === agentName) {
    return [
      `You are the orchestrator of the DevHub team "${team.name}". Your workers: ${team.teammates.join(', ') || '(none)'}.`,
      'The user talks only to you; the workers cannot be contacted by the user and only act on your messages.',
      "Your job: understand the user's task, plan it, split it into self-contained work packages that fit the workers' roles, " +
        'hand them over with `send_team_message`, track progress (`team_members` shows their status), review and integrate their results, ' +
        'resolve conflicts between them, and report back to the user. Do not implement larger changes yourself – delegate them; ' +
        'reading code, checking diffs and running quick checks to review results is fine.',
      'If the task is unclear, ask the user before delegating. Answer questions from workers yourself, or ask the user if only they can decide.',
      'Messages from workers arrive in your terminal prefixed with "[Team message from <name>]"; DevHub status notes start with "[Team status]".',
      'Permission requests: a worker that needs approval for a tool call is blocked, and you receive "[Permission request #<id> from <name>]". ' +
        'Answer every request promptly with `answer_permission`. Allow it if it is clearly needed for the work package you gave and stays within the project; ' +
        'if it is destructive, irreversible, touches things outside the project, or you are unsure, ask the user first (AskUserQuestion), then answer.',
      'You all share one working directory: give workers separate files or areas so they do not edit the same files at the same time.',
      guidelines
    ]
      .filter(Boolean)
      .join('\n')
  }
  return [
    `You are a worker in the DevHub team "${team.name}", coordinated by the orchestrator ${team.lead}.`,
    `Other workers: ${team.teammates.join(', ') || '(none)'}.`,
    `You only receive work from ${team.lead} (messages prefixed with "[Team message from ${team.lead}]"). The user watches your terminal but cannot answer you.`,
    `Do not ask the user anything; if something is unclear, ask ${team.lead} with \`send_team_message\` and wait for the answer.`,
    `When you finish a work package, send ${team.lead} a concise, self-contained report with \`send_team_message\` (what you changed, which files, how you verified it, open issues). ` +
      'Do not send pure acknowledgements.',
    `Tool permissions are decided by ${team.lead}; if a request is denied, follow the given reason instead of retrying the same action.`,
    'You share one working directory with the other workers: only edit the files/areas assigned to you.',
    guidelines
  ]
    .filter(Boolean)
    .join('\n')
}

/** Last lines of the output without terminal control sequences (for error messages). */
function lastLines(output: string, count = 6): string {
  return output
    .replace(ANSI, '')
    .split(/\r?\n|\r/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-count)
    .join('\n')
}

/** CSI, OSC and simple ESC sequences */
const ANSI =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>]/g

/** Does a transcript already exist for the session? Only then is --resume possible. */
function sessionExists(sessionId: string): boolean {
  const base = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
  try {
    return readdirSync(base).some((dir) => existsSync(join(base, dir, `${sessionId}.jsonl`)))
  } catch {
    return false
  }
}
