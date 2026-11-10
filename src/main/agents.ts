import * as pty from 'node-pty'
import { randomUUID } from 'crypto'
import { existsSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, resolve as resolvePath } from 'path'
import type { Agent, AgentStatus, CodeFocus } from '../shared/types'
import { AgentBridge, HookEvent, ShowCodeArgs } from './agentBridge'
import { dataDir, getState, updateState } from './store'
import { claudeEnv, resolveClaude } from './tools'

/** Wird jedem Agent per --append-system-prompt mitgegeben. */
const SYSTEM_HINT =
  'You are running inside DevHub, a desktop app that shows your terminal next to a code panel. ' +
  'Whenever you analyze code, investigate a problem or find a bug, call the `show_code` tool of the ' +
  '`devhub` MCP server with the affected file and line range so the user sees the spot highlighted. ' +
  'Call it again whenever your focus moves to another location.'

const MAX_BUFFER = 200_000

interface RunningAgent {
  agent: Agent
  proc: pty.IPty
  buffer: string
}

export interface AgentEvents {
  onData: (id: string, data: string) => void
  onChanged: (agents: Agent[]) => void
  onCodeFocus: (focus: CodeFocus) => void
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
      onShowCode: (id, args) => this.handleShowCode(id, args)
    })
  }

  init(): Promise<void> {
    return this.bridge.start()
  }

  list(): Agent[] {
    return [...this.running.values()].map((r) => r.agent)
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
        await this.spawn({ ...saved, status: 'starting' }, undefined)
      } catch (e) {
        console.error('[DevHub] Agent konnte nicht wiederhergestellt werden:', saved.name, e)
        updateState((s) => (s.agents = s.agents.filter((a) => a.id !== saved.id)))
      }
    }
    this.emitChanged()
  }

  async start(projectId: string, task?: string): Promise<Agent> {
    const project = getState().projects.find((p) => p.id === projectId)
    if (!project) throw new Error('Projekt nicht gefunden')

    const agent: Agent = {
      id: randomUUID(),
      projectId,
      name: this.nextName(),
      sessionId: randomUUID(),
      status: 'starting',
      createdAt: Date.now()
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
    if (r) r.proc.kill()
    else this.forget(id)
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
    const args: string[] = sessionExists(agent.sessionId)
      ? ['--resume', agent.sessionId]
      : ['--session-id', agent.sessionId]
    args.push('--settings', settingsFile, '--mcp-config', mcpFile)
    args.push('--append-system-prompt', SYSTEM_HINT)
    if (task) args.push(task)

    // claude.exe direkt starten; ein .cmd-Wrapper braucht cmd.exe (dort keine Sonderzeichen erlaubt)
    const isExe = claude.toLowerCase().endsWith('.exe')
    const file = isExe ? claude : 'cmd.exe'
    const argv = isExe ? args : ['/c', claude, ...args.map((a) => a.replace(/["%^&|<>]/g, ' '))]

    const proc = pty.spawn(file, argv, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: project.agentPath,
      env: claudeEnv({ FORCE_COLOR: '1' })
    })

    if (process.env.DEVHUB_DEBUG)
      console.log('[DevHub] Agent gestartet', agent.name, file, argv.join(' '))
    const r: RunningAgent = { agent, proc, buffer: '' }
    this.running.set(agent.id, r)

    proc.onData((data) => {
      r.buffer = (r.buffer + data).slice(-MAX_BUFFER)
      if (agent.status === 'starting') this.setStatus(agent.id, 'idle')
      this.events.onData(agent.id, data)
    })

    proc.onExit(() => {
      this.running.delete(agent.id)
      if (this.quitting) return
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
      permissions: { allow: ['mcp__devhub__show_code'] }
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
    this.emitChanged()
  }

  private forget(id: string): void {
    updateState((s) => (s.agents = s.agents.filter((a) => a.id !== id)))
    try {
      rmSync(join(dataDir('agents'), id), { recursive: true, force: true })
    } catch {
      // ignorieren
    }
    this.emitChanged()
  }

  /** Kleinste freie Nummer über alle Agents → eindeutige Namen für die Sprachsteuerung. */
  private nextName(): string {
    const used = new Set(
      getState()
        .agents.map((a) => /^Agent (\d+)$/.exec(a.name)?.[1])
        .filter(Boolean)
        .map(Number)
    )
    let n = 1
    while (used.has(n)) n++
    return `Agent ${n}`
  }

  private emitChanged(): void {
    this.events.onChanged(this.list())
  }
}

function persisted(a: Agent): Omit<Agent, 'status' | 'statusMessage'> {
  return {
    id: a.id,
    projectId: a.projectId,
    name: a.name,
    sessionId: a.sessionId,
    createdAt: a.createdAt
  }
}

/** Gibt es zu der Session schon ein Transkript? Nur dann ist --resume möglich. */
function sessionExists(sessionId: string): boolean {
  const base = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
  try {
    return readdirSync(base).some((dir) => existsSync(join(base, dir, `${sessionId}.jsonl`)))
  } catch {
    return false
  }
}
