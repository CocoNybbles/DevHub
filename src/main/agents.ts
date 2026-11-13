import * as pty from 'node-pty'
import { randomUUID } from 'crypto'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, resolve as resolvePath } from 'path'
import { exec } from 'child_process'
import type {
  ActivityEntry,
  Agent,
  AgentStatus,
  AgentWorktree,
  ArchivedSession,
  CodeFocus,
  CodePlan,
  CodeSnippet,
  EditedFile,
  PermissionAnswer,
  PermissionInfo,
  Project,
  Task,
  Team,
  TeamMember,
  UserNotice
} from '../shared/types'
import { isTeamWorker, teamLead } from '../shared/types'
import { editFromToolResult, mergeEdits, mergeSnippets, TranscriptReader } from './snippets'
import {
  AgentBridge,
  AnswerPermissionArgs,
  COMMON_TOOLS,
  HookEvent,
  PermissionDecision,
  ShowCodeArgs,
  TeamMessageArgs,
  ToolName
} from './agentBridge'
import { applyOrder, dataDir, getState, updateState, type PersistedAgent } from './store'
import { claudeEnv, resolveClaude } from './tools'
import { isValidModelName, mergeAgentArgs } from '../shared/agentArgs'
import {
  createWorktree,
  removeWorktreeIfUnused,
  repoRoot,
  restoreWorktree,
  worktreeBranch,
  worktreeCwd,
  worktreesDir,
  worktreeDirName
} from './git'
import { describeTool, matchesRule, ruleFor } from '../shared/permissions'

/** Passed to every agent via --append-system-prompt. */
const SYSTEM_HINT =
  'You are running inside DevHub, a desktop app that shows your terminal next to a code panel. ' +
  'Whenever you analyze code, investigate a problem or find a bug, call the `show_code` tool of the ' +
  '`devhub` MCP server with the affected file and line range so the user sees the spot highlighted. ' +
  'Call it again whenever your focus moves to another location. ' +
  'The same server offers more tools: `show_plan` (show a plan or summary as Markdown in the side panel), ' +
  '`report_progress` (progress of longer tasks), `notify_user` (only for things worth interrupting for), ' +
  '`show_diff` (open the review of your changes) and `run_list`/`run_output`/`run_start`/`run_stop` ' +
  '(project commands such as the dev server or tests that DevHub runs for the user – prefer reading their ' +
  'output over starting the same long-running process yourself).'

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
  /** Working directory (agent folder or worktree) */
  cwd: string
  /** Open `AskUserQuestion`: input would answer it → deliver nothing */
  asking: boolean
  /** The turn has ended (Stop), the agent accepts the next job */
  turnDone: boolean
  /** A file was changed since the last instruction → checks are worthwhile */
  editedThisTurn: boolean
  /** Check command that failed most recently in this turn */
  gateFailed?: string
  /** How often the checks have already sent the agent back in this turn */
  gateRounds: number
  /** Result of the checks for the status text after the Stop */
  gateNote?: string
  /** The user is currently typing (unsent text in the input field) – time of the last key */
  draftAt: number
  /** Latest steps (tool calls), newest first */
  activityLog: ActivityEntry[]
  /** Context warning has already been shown for this fill level */
  contextWarned: boolean
  /** The user's first instruction (title in the history) */
  title?: string
  /** Other engine: timer that resets "working" after a pause in the output */
  quietTimer?: ReturnType<typeof setTimeout>
  /** When the transcript was last read for the usage display */
  usageReadAt: number
}

/** Open permission request (claude waits for the hook response): decided by the orchestrator or the user */
interface PermissionRequest {
  workerId: string
  /** `user`: sits in the user's inbox */
  kind: 'orchestrator' | 'user'
  info: PermissionInfo
  finish: (decision: PermissionDecision | null) => void
}

/** Failed checks send the agent back at most this many times per instruction */
const MAX_GATE_ROUNDS = 3
/** Maximum runtime of a check command */
const CHECK_TIMEOUT_MS = 10 * 60_000
/** How long typed, unsent text counts as a draft (after that, delivery resumes) */
const DRAFT_HOLD_MS = 45_000
const MAX_ACTIVITY = 60
const MAX_ARCHIVE = 200
/** Other engines: this long without output = waiting */
const QUIET_MS = 2500

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
  /** Open approvals for the user's inbox have changed */
  onPermissions: (list: PermissionInfo[]) => void
  /** Notice for the user (notify_user, context warning) */
  onNotice: (notice: UserNotice) => void
  /** Agent is now waiting for the user (question, done, approval) → notification if applicable */
  onAttention: (agent: Agent, message: string) => void
  /** Agent has finished its turn (for reading the summary aloud) */
  onTurnFinished: (agent: Agent) => void
  onPlan: (plan: CodePlan) => void
  onShowDiff: (agentId: string, filePath?: string) => void
  onTasksChanged: (tasks: Task[]) => void
  /** MCP tools `run_*`: project commands (Run window) */
  runTool: (
    project: Project,
    tool: 'run_list' | 'run_output' | 'run_start' | 'run_stop',
    args: Record<string, unknown>
  ) => string
}

/** Extras when starting an agent (beyond name/model/template) */
export interface StartExtra {
  engineId?: string
  /** Continue this session's conversation as a copy */
  forkFrom?: string
  /** Continue an existing session (from the history) */
  sessionId?: string
  /** Name (e.g. the earlier one from the history); numbered if necessary */
  name?: string
  /** Reuse an existing worktree (from the history) */
  worktree?: AgentWorktree
  /** Task from the board that is worked on with `task` */
  taskId?: string
  /** Start in the agent folder, even if the project uses worktrees */
  noWorktree?: boolean
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
/** Stop hook: time for all check commands together (seconds) */
const STOP_TIMEOUT_S = 60 * 60

const noop = (): void => {}

export class AgentManager {
  private running = new Map<string, RunningAgent>()
  private bridge: AgentBridge
  private quitting = false
  /** Restore only once per app start */
  private restored = false
  private editors = new Map<string, EditorSession>()
  private permissions = new Map<number, PermissionRequest>()
  private nextPermissionId = 1
  private nextNoticeId = 1

  constructor(private events: AgentEvents) {
    this.bridge = new AgentBridge({
      onHook: (id, ev) => this.handleHook(id, ev),
      tools: (id) => {
        const a = this.running.get(id)?.agent
        if (!a?.teamId) return COMMON_TOOLS
        const team: ToolName[] = [...COMMON_TOOLS, 'team_members', 'send_team_message']
        return a.teamRole === 'orchestrator' ? [...team, 'answer_permission'] : team
      },
      onToolCall: (id, name, args) => this.handleToolCall(id, name, args),
      onEditor: (id, filePath) => this.openEditor(id, filePath),
      onEditorAbort: (id) => this.closeEditor(id),
      onPermission: (id, ev, signal) => this.requestPermission(id, ev, signal),
      onStop: (id, ev) => this.handleStop(id, ev)
    })
    // Deliver held-back messages as soon as the user is no longer typing
    setInterval(() => {
      for (const r of this.running.values()) {
        if (r.pending.length) this.flushPending(r.agent.id)
        if (r.agent.queue?.length) this.sendNextQueued(r.agent.id)
      }
    }, 5000).unref()
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
        // Workers each get their own worktree, the orchestrator merges in the main folder
        if (agent !== orchestrator) await this.prepareWorktree(agent, project)
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
    templateId?: string,
    extra: StartExtra = {}
  ): Promise<Agent> {
    const project = getState().projects.find((p) => p.id === projectId)
    if (!project) throw new Error('Projekt nicht gefunden')
    const m = model?.trim() || undefined
    if (m && !isValidModelName(m)) throw new Error(`Ungültiger Modellname: ${m}`)
    const template = templateId ? getState().templates.find((t) => t.id === templateId) : undefined
    if (templateId && !template) throw new Error('Vorlage nicht gefunden')
    const engine = extra.engineId
      ? getState().engines.find((e) => e.id === extra.engineId)
      : undefined
    if (extra.engineId && !engine) throw new Error('Engine nicht gefunden')
    // Don't use "Agent 3" from the history as the base (would yield "Agent 3 2")
    const wanted = extra.name && !/^agent \d+$/i.test(extra.name.trim()) ? extra.name.trim() : ''

    const agent: Agent = {
      id: randomUUID(),
      projectId,
      name: this.nextName(wanted || template?.name || engine?.name),
      sessionId: extra.sessionId ?? randomUUID(),
      status: 'starting',
      createdAt: Date.now(),
      model: m,
      templateId: template?.id,
      engineId: engine?.id,
      forkFrom: extra.forkFrom,
      worktree: extra.worktree,
      currentTaskId: extra.taskId
    }
    // Save first (reserves the name), then start
    updateState((s) => s.agents.push(persisted(agent)))
    try {
      if (!extra.noWorktree) await this.prepareWorktree(agent, project)
      await this.spawn(agent, task?.trim() || undefined)
    } catch (e) {
      updateState((s) => (s.agents = s.agents.filter((a) => a.id !== agent.id)))
      if (agent.worktree && !extra.worktree) void removeWorktreeIfUnused(agent.worktree).catch(noop)
      throw e
    }
    this.emitChanged()
    return agent
  }

  /** Project with worktrees: create a separate working directory (own branch) for the new agent. */
  private async prepareWorktree(agent: Agent, project: Project): Promise<void> {
    if (agent.worktree || !project.useWorktrees) return
    const repo = await repoRoot(project.agentPath)
    if (!repo) {
      throw new Error(
        `Für „${project.name}“ sind Worktrees eingeschaltet, der Agent-Ordner liegt aber in keinem Git-Repository (oder git fehlt).`
      )
    }
    agent.worktree = await createWorktree(
      repo,
      join(worktreesDir(repo), worktreeDirName(agent.name, agent.id)),
      worktreeBranch(agent.name, agent.id)
    )
    updateState((s) => {
      const saved = s.agents.find((a) => a.id === agent.id)
      if (saved) saved.worktree = agent.worktree
    })
  }

  /** New agent that continues a running agent's conversation as a copy (same directory). */
  async fork(id: string): Promise<Agent> {
    const a = this.running.get(id)?.agent
    if (!a) throw new Error('Agent läuft nicht mehr')
    if (a.engineId) throw new Error('Abzweigen geht nur mit Claude-Code-Agents')
    if (a.teamId) throw new Error('Teammitglieder können nicht abgezweigt werden')
    if (!sessionExists(a.sessionId))
      throw new Error(`${a.name} hat noch keine gespeicherte Unterhaltung`)
    return this.start(a.projectId, undefined, a.model, a.templateId, {
      forkFrom: a.sessionId,
      worktree: a.worktree,
      noWorktree: true
    })
  }

  /** Continue a session from the history; `fork`: as a copy (the entry stays in the history). */
  async resumeArchived(id: string, fork = false): Promise<Agent> {
    const entry = getState().archive.find((x) => x.id === id)
    if (!entry) throw new Error('Eintrag nicht gefunden')
    if (!sessionExists(entry.sessionId))
      throw new Error('Das Transkript dieser Sitzung gibt es nicht mehr')
    if (this.list().some((a) => a.sessionId === entry.sessionId))
      throw new Error('Diese Sitzung läuft bereits')
    // A session can only be continued in its own directory → recreate a cleaned-up worktree
    if (entry.worktree) await restoreWorktree(entry.worktree)
    const templateId = getState().templates.some((t) => t.id === entry.templateId)
      ? entry.templateId
      : undefined
    const agent = await this.start(entry.projectId, undefined, entry.model, templateId, {
      name: entry.name,
      sessionId: fork ? undefined : entry.sessionId,
      forkFrom: fork ? entry.sessionId : undefined,
      worktree: entry.worktree,
      noWorktree: true
    })
    if (!fork) updateState((s) => (s.archive = s.archive.filter((x) => x.id !== id)))
    return agent
  }

  /** Stop via the UI: workers only with the whole team, the orchestrator stops the team. */
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
    if (!r || r.agent.editing || isTeamWorker(r.agent)) return
    // Detect a draft in the input field: while the user is typing, no automatic messages
    // (team, queue) are written in between. Enter/Ctrl+C/Ctrl+U clear it.
    // eslint-disable-next-line no-control-regex
    if (/[\r\n\x03\x15]/.test(data)) r.draftAt = 0
    // eslint-disable-next-line no-control-regex
    else if (!data.startsWith('\x1b') && /[^\x00-\x1f\x7f]/.test(data)) r.draftAt = Date.now()
    r.proc.write(data)
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

    // Worktree was removed by hand → continue working in the agent folder
    if (agent.worktree && !existsSync(agent.worktree.path)) {
      agent.worktree = undefined
      updateState((s) => {
        const saved = s.agents.find((a) => a.id === agent.id)
        if (saved) saved.worktree = undefined
      })
    }
    const cwd = agent.worktree ? worktreeCwd(agent.worktree, project.agentPath) : project.agentPath

    const engine = agent.engineId
      ? getState().engines.find((e) => e.id === agent.engineId)
      : undefined
    if (agent.engineId && !engine) throw new Error('Die Engine dieses Agents wurde gelöscht')
    if (engine) return this.spawnEngine(agent, engine.command, cwd, task)

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
    else if (agent.forkFrom && sessionExists(agent.forkFrom)) {
      // Copy of a conversation: load the old session, continue writing under its own id
      args.push('--resume', agent.forkFrom, '--fork-session', '--session-id', agent.sessionId)
    } else args.push('--session-id', agent.sessionId)
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
      cwd,
      env
    })

    if (process.env.DEVHUB_DEBUG)
      console.log('[DevHub] Agent gestartet', agent.name, file, argv.join(' '))
    const r = this.track(agent, proc, cwd)

    proc.onData((data) => {
      r.buffer = (r.buffer + data).slice(-MAX_BUFFER)
      if (agent.status === 'starting') this.setStatus(agent.id, 'idle')
      this.events.onData(agent.id, data)
    })
  }

  /** Register a running process; cleans up when it ends (for Claude agents and other engines). */
  private track(agent: Agent, proc: pty.IPty, cwd: string): RunningAgent {
    const r: RunningAgent = {
      agent,
      proc,
      buffer: '',
      startedAt: Date.now(),
      stopping: false,
      pending: [],
      snippets: [],
      edits: [],
      reported: false,
      cwd,
      asking: false,
      turnDone: true,
      editedThisTurn: false,
      gateRounds: 0,
      draftAt: 0,
      activityLog: [],
      contextWarned: false,
      usageReadAt: 0
    }
    this.running.set(agent.id, r)

    proc.onExit(({ exitCode }) => {
      this.running.delete(agent.id)
      clearTimeout(r.quietTimer)
      // Open editor tab: answer the request so that an orphaned curl process ends
      this.closeEditor(agent.id)
      // This agent's open approvals expire
      for (const p of [...this.permissions.values()]) if (p.workerId === agent.id) p.finish(null)
      if (this.quitting) return
      const failed = !r.stopping && exitCode !== 0 && Date.now() - r.startedAt < EARLY_EXIT_MS
      if (failed) this.events.onStartFailed(agent.name, lastLines(r.buffer))
      // Agent was stopped in the terminal or via the list → remove the entry
      this.forget(agent.id, failed ? undefined : r)
      // Without an orchestrator the team can no longer be controlled → stop the workers too
      if (agent.teamId && agent.teamRole === 'orchestrator') this.stopTeam(agent.teamId)
    })
    return r
  }

  /**
   * Other engine (e.g. Codex CLI, Gemini CLI): any terminal program in the working directory.
   * Without hooks there is neither a status nor file tabs; "working" = output is currently arriving.
   */
  private spawnEngine(agent: Agent, command: string, cwd: string, task: string | undefined): void {
    // The user's command line goes unchanged to cmd.exe (one string → node-pty does not re-quote)
    const proc = pty.spawn('cmd.exe', `/d /s /c "${command}"`, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: claudeEnv({ FORCE_COLOR: '1' })
    })
    if (process.env.DEVHUB_DEBUG) console.log('[DevHub] Engine gestartet', agent.name, command)
    const r = this.track(agent, proc, cwd)
    let taskSent = !task
    proc.onData((data) => {
      r.buffer = (r.buffer + data).slice(-MAX_BUFFER)
      this.events.onData(agent.id, data)
      this.setStatus(agent.id, 'working')
      clearTimeout(r.quietTimer)
      r.quietTimer = setTimeout(() => {
        this.setStatus(agent.id, 'idle', 'Keine Ausgabe – wartet vermutlich')
        // Type in the task as soon as the engine's UI is up
        if (!taskSent) {
          taskSent = true
          void this.typeLine(agent.id, task!).catch(noop)
        }
      }, QUIET_MS)
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
        // Without -m: the request stays open while the project's checks are running; the
        // output is the hook response (empty = stop, `decision: block` = keep working)
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: `curl.exe -s -X POST -H "Content-Type: application/json" --data-binary @- ${this.bridge.stopUrl(agentId)}`,
                timeout: STOP_TIMEOUT_S
              }
            ]
          }
        ],
        // Without -m: open until decided – for a worker by the orchestrator, otherwise by
        // a project rule or the user in the inbox (empty response = normal dialog in the terminal)
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
      },
      permissions: {
        allow: [
          ...COMMON_TOOLS.map((t) => `mcp__devhub__${t}`),
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
    if (!r) return
    // Bookkeeping for all agents: turn, open question, activity, changed files
    switch (ev.hook_event_name) {
      case 'UserPromptSubmit':
        r.turnDone = false
        r.editedThisTurn = false
        r.gateRounds = 0
        r.gateNote = undefined
        r.gateFailed = undefined
        r.asking = false
        r.draftAt = 0
        r.agent.progress = undefined
        r.agent.activity = undefined
        break
      case 'PreToolUse':
        r.asking = ev.tool_name === 'AskUserQuestion'
        this.addActivity(
          r,
          describeTool(String(ev.tool_name ?? ''), ev.tool_input as Record<string, unknown>)
        )
        break
      case 'PostToolUse': {
        r.asking = false
        // Edit/Write/MultiEdit: show the file as a tab on the right immediately
        const edit = editFromToolResult(agentId, ev.tool_response, Date.now())
        if (edit) {
          r.editedThisTurn = true
          this.addEdits(agentId, [edit])
        }
        // Keep usage/context up to date continuously (throttled)
        if (Date.now() - r.usageReadAt > 4000) this.readSnippets(agentId)
        break
      }
      case 'Stop':
        r.asking = false
        r.turnDone = true
        r.agent.activity = undefined
        break
    }
    /** Open approval: the status stays as it is until decided */
    const awaitingPermission = [...this.permissions.values()].some((p) => p.workerId === agentId)
    // Workers never wait for the user (who cannot answer them): done = idle
    if (isTeamWorker(r.agent)) {
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
      case 'PostToolUse':
        // An open permission request stays visible until it is decided
        if (!awaitingPermission) this.setStatus(agentId, 'working')
        break
      case 'UserPromptSubmit':
        this.setStatus(agentId, 'working')
        break
      case 'PreToolUse':
        // AskUserQuestion waits for the user, all other tools = work
        if (ev.tool_name === 'AskUserQuestion') {
          this.setStatus(agentId, 'needsInput', 'Stellt eine Frage')
        } else if (!awaitingPermission) {
          this.setStatus(agentId, 'working')
        }
        break
      case 'Notification':
        // The approval is already in the inbox (claude's notice about it would replace the text)
        if (!awaitingPermission) {
          this.setStatus(agentId, 'needsInput', ev.message || 'Benötigt Eingabe')
        }
        break
      case 'Stop':
        this.setStatus(agentId, 'needsInput', r.gateNote ?? 'Fertig – wartet auf Eingabe')
        break
    }
  }

  // ------------------------------------------------------------ Done report: checks, queue

  /**
   * Stop hook: if the agent changed files in this turn and the project has check commands, they
   * run now. If one fails, the agent gets the output as the reason to keep working
   * (at most MAX_GATE_ROUNDS times per instruction). Afterwards: status, task done, next job.
   */
  private async handleStop(agentId: string, ev: HookEvent): Promise<object | null> {
    const r = this.running.get(agentId)
    if (!r) return null
    const project = getState().projects.find((p) => p.id === r.agent.projectId)
    const checks = parseChecks(project?.checks)
    r.gateNote = undefined
    // Nothing changed since the last failure (e.g. the agent explained why it is not
    // fixing it) → do not check and send it back again
    if (checks.length && !r.editedThisTurn && r.gateFailed) {
      r.gateNote = `Fertig – Prüfung „${r.gateFailed}“ schlägt fehl`
    }
    if (checks.length && r.editedThisTurn) {
      // Only new changes trigger the next check
      r.editedThisTurn = false
      this.setStatus(agentId, 'working', 'Prüfungen laufen …')
      const failure = await runChecks(checks, r.cwd, (cmd) =>
        this.addActivity(r, `Prüfung: ${cmd}`)
      )
      if (this.running.get(agentId) !== r) return null
      r.gateFailed = failure?.command
      if (failure && r.gateRounds < MAX_GATE_ROUNDS) {
        r.gateRounds++
        this.addActivity(r, `Prüfung fehlgeschlagen: ${failure.command}`)
        this.setStatus(
          agentId,
          'working',
          `Prüfung fehlgeschlagen – korrigiert (${r.gateRounds}/${MAX_GATE_ROUNDS})`
        )
        return {
          decision: 'block',
          reason:
            `DevHub quality gate: the project check \`${failure.command}\` failed ` +
            `(${failure.code === null ? 'timeout or not startable' : `exit code ${failure.code}`}). ` +
            'Fix the cause, then finish again; the checks run again automatically. ' +
            'If the failure is unrelated to your changes or you cannot fix it, say so instead of retrying.\n' +
            `Output (end):\n${failure.output}`
        }
      }
      r.gateNote = failure
        ? `Fertig – Prüfung „${failure.command}“ schlägt weiter fehl`
        : 'Fertig – Prüfungen grün'
    }
    this.handleHook(agentId, { ...ev, hook_event_name: 'Stop' })
    this.afterStop(r)
    return null
  }

  /** Turn ended: tick off the task, send the next job from the queue, read aloud if applicable. */
  private afterStop(r: RunningAgent): void {
    const agent = r.agent
    if (isTeamWorker(agent)) return
    if (agent.currentTaskId) {
      this.updateTask(agent.currentTaskId, { status: 'done', doneAt: Date.now() })
      agent.currentTaskId = undefined
      this.saveAgent(agent)
    }
    if (agent.queue?.length) {
      setTimeout(() => this.sendNextQueued(agent.id), 600)
      return
    }
    // Only after the second read of the transcript is the last response reliably in it
    setTimeout(() => {
      if (this.running.get(agent.id) === r && r.turnDone) this.events.onTurnFinished(agent)
    }, 2200)
  }

  /** Send the next job as soon as the agent is free (otherwise retried later). */
  private sendNextQueued(id: string): void {
    const r = this.running.get(id)
    if (!r || !r.agent.queue?.length) return
    // Other engines do not report "done" → type it in immediately
    if (!r.agent.engineId && (!r.turnDone || this.mustHold(r))) return
    const [next, ...rest] = r.agent.queue
    r.agent.queue = rest
    r.agent.currentTaskId = next.taskId
    r.turnDone = false
    this.saveAgent(r.agent)
    if (next.taskId) {
      this.updateTask(next.taskId, {
        status: 'running',
        agentId: r.agent.id,
        agentName: r.agent.name
      })
    }
    this.emitChanged()
    void this.typeLine(id, next.text).catch((e) => console.error('[DevHub] Warteschlange:', e))
  }

  /** Append a job – sent as soon as the agent is done (immediately if it is free). */
  enqueue(id: string, text: string, taskId?: string): void {
    const r = this.running.get(id)
    if (!r) throw new Error('Agent läuft nicht mehr')
    if (isTeamWorker(r.agent))
      throw new Error(`${r.agent.name} bekommt Aufträge nur vom Orchestrator`)
    const t = text.trim()
    if (!t) throw new Error('Auftrag ist leer')
    r.agent.queue = [...(r.agent.queue ?? []), { id: randomUUID(), text: t, taskId }]
    this.saveAgent(r.agent)
    this.emitChanged()
    this.sendNextQueued(id)
  }

  dequeue(id: string, queueId: string): void {
    const r = this.running.get(id)
    if (!r) return
    const removed = r.agent.queue?.find((q) => q.id === queueId)
    r.agent.queue = (r.agent.queue ?? []).filter((q) => q.id !== queueId)
    this.saveAgent(r.agent)
    if (removed?.taskId)
      this.updateTask(removed.taskId, { agentId: undefined, agentName: undefined })
    this.emitChanged()
  }

  private saveAgent(agent: Agent): void {
    updateState((s) => {
      const i = s.agents.findIndex((a) => a.id === agent.id)
      if (i >= 0) s.agents[i] = { ...persisted(agent), needsInput: s.agents[i].needsInput }
    })
  }

  // ------------------------------------------------------------ Tasks (board)

  tasks(): Task[] {
    return getState().tasks
  }

  saveTask(input: { id?: string; projectId: string; text: string }): Task {
    const text = input.text?.trim()
    if (!text) throw new Error('Aufgabe ist leer')
    if (!getState().projects.some((p) => p.id === input.projectId))
      throw new Error('Projekt nicht gefunden')
    const existing = getState().tasks.find((t) => t.id === input.id)
    const task: Task = existing
      ? { ...existing, text }
      : {
          id: randomUUID(),
          projectId: input.projectId,
          text,
          status: 'open',
          createdAt: Date.now()
        }
    updateState((s) => {
      const i = s.tasks.findIndex((t) => t.id === task.id)
      if (i >= 0) s.tasks[i] = task
      else s.tasks.push(task)
    })
    this.events.onTasksChanged(getState().tasks)
    return task
  }

  removeTask(id: string): void {
    // Also remove it from queues
    for (const r of this.running.values()) {
      if (r.agent.queue?.some((q) => q.taskId === id)) {
        r.agent.queue = r.agent.queue.filter((q) => q.taskId !== id)
        this.saveAgent(r.agent)
      }
    }
    updateState((s) => (s.tasks = s.tasks.filter((t) => t.id !== id)))
    this.events.onTasksChanged(getState().tasks)
    this.emitChanged()
  }

  updateTask(id: string, patch: Partial<Task>): void {
    if (!getState().tasks.some((t) => t.id === id)) return
    updateState((s) => {
      const t = s.tasks.find((x) => x.id === id)
      if (!t) return
      Object.assign(t, patch)
      if (patch.status && patch.status !== 'done') t.doneAt = undefined
      if (patch.status === 'done') t.doneAt ??= Date.now()
    })
    this.events.onTasksChanged(getState().tasks)
  }

  /** Start a new agent that works on the task */
  async startTask(id: string, templateId?: string): Promise<Agent> {
    const task = getState().tasks.find((t) => t.id === id)
    if (!task) throw new Error('Aufgabe nicht gefunden')
    const agent = await this.start(task.projectId, task.text, undefined, templateId, { taskId: id })
    this.updateTask(id, { status: 'running', agentId: agent.id, agentName: agent.name })
    return agent
  }

  /** Give the task to a running agent (it works on it as soon as it is free) */
  assignTask(id: string, agentId: string): void {
    const task = getState().tasks.find((t) => t.id === id)
    const agent = this.running.get(agentId)?.agent
    if (!task || !agent) throw new Error('Aufgabe oder Agent nicht gefunden')
    this.updateTask(id, { status: 'open', agentId: agent.id, agentName: agent.name })
    this.enqueue(agentId, task.text, id)
  }

  // ------------------------------------------------------------ Activity

  private addActivity(r: RunningAgent, text: string): void {
    if (!text) return
    r.agent.activity = text
    r.activityLog.unshift({ at: Date.now(), text })
    if (r.activityLog.length > MAX_ACTIVITY) r.activityLog.length = MAX_ACTIVITY
    this.emitChanged()
  }

  activityLog(id: string): ActivityEntry[] {
    return this.running.get(id)?.activityLog ?? []
  }

  private notice(agentId: string | undefined, message: string): void {
    this.events.onNotice({ id: this.nextNoticeId++, agentId, message, at: Date.now() })
  }

  /** History: ended sessions, newest first */
  archive(): ArchivedSession[] {
    return getState().archive
  }

  removeArchived(id: string): void {
    updateState((s) => (s.archive = s.archive.filter((x) => x.id !== id)))
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
    const running = this.running.get(agentId)
    const reader = running?.transcript
    if (!running || !reader) return
    running.usageReadAt = Date.now()
    reader
      .read()
      .then(({ snippets, edits, usage, lastText, firstPrompt }) => {
        const r = this.running.get(agentId)
        if (!r || r.transcript !== reader) return
        r.title ??= firstPrompt
        if (usage || lastText !== undefined) {
          if (usage) {
            r.agent.usage = usage
            this.checkContext(r)
          }
          if (lastText !== undefined) r.agent.lastMessage = lastText
          this.emitChanged()
        }
        // After a restore, the edited files come from the transcript
        this.addEdits(agentId, edits)
        if (!snippets.length) return
        r.snippets = mergeSnippets(r.snippets, snippets)
        this.events.onSnippets(agentId, r.snippets)
      })
      .catch((e) => console.error('[DevHub] Transkript nicht lesbar:', e))
  }

  /** Warn once when the context exceeds the configured threshold */
  private checkContext(r: RunningAgent): void {
    const limit = getState().settings.contextWarnTokens
    const context = r.agent.usage?.context ?? 0
    if (!limit) return
    if (context >= limit && !r.contextWarned) {
      r.contextWarned = true
      this.notice(
        r.agent.id,
        `${r.agent.name}: Kontext bei ${Math.round(context / 1000)}k Tokens – /compact oder /clear erwägen, bevor automatisch verdichtet wird.`
      )
    } else if (context < limit * 0.6) r.contextWarned = false
  }

  private async handleToolCall(
    agentId: string,
    name: ToolName,
    args: Record<string, unknown>
  ): Promise<string> {
    const r = this.running.get(agentId)
    if (!r) throw new Error('Unknown agent')
    const text = (key: string): string => String(args[key] ?? '').trim()
    switch (name) {
      case 'show_plan': {
        if (!text('title') || !text('markdown')) throw new Error('title and markdown are required')
        this.events.onPlan({
          agentId,
          title: text('title').slice(0, 80),
          markdown: String(args.markdown),
          at: Date.now()
        })
        return 'Shown to the user in the DevHub side panel.'
      }
      case 'show_diff': {
        const file = text('file_path')
        this.events.onShowDiff(agentId, file ? resolvePath(r.cwd, file) : undefined)
        return 'The review window with your changes was opened for the user.'
      }
      case 'notify_user': {
        if (!text('message')) throw new Error('message is required')
        const message = text('message').slice(0, 400)
        this.notice(agentId, `${r.agent.name}: ${message}`)
        this.events.onAttention(r.agent, message)
        return 'The user was notified.'
      }
      case 'report_progress': {
        if (!text('message')) throw new Error('message is required')
        const percent = Number(args.percent)
        r.agent.progress = {
          message: text('message').slice(0, 120),
          percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : undefined
        }
        this.emitChanged()
        return 'Progress shown.'
      }
      case 'run_list':
      case 'run_output':
      case 'run_start':
      case 'run_stop': {
        const project = getState().projects.find((p) => p.id === r.agent.projectId)
        if (!project) throw new Error('Project not found')
        return this.events.runTool(project, name, args)
      }
    }
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
    if (!worker) return Promise.resolve(null)
    const tool = String(ev.tool_name ?? '?')
    const toolInput = (ev.tool_input ?? {}) as Record<string, unknown>
    const project = getState().projects.find((p) => p.id === worker.agent.projectId)
    // Project rules ("always allow") decide immediately – for all agents
    if ((project?.permissionRules ?? []).some((rule) => matchesRule(rule, tool, toolInput))) {
      this.addActivity(worker, `Automatisch erlaubt: ${describeTool(tool, toolInput)}`)
      return Promise.resolve({ behavior: 'allow' })
    }
    const isWorker = isTeamWorker(worker.agent)
    const lead = isWorker ? this.leadOf(worker.agent) : undefined
    if (isWorker && !lead) {
      return Promise.resolve({
        behavior: 'deny',
        message: 'No orchestrator is running for your team, so nobody can approve this.'
      })
    }
    // Normal agents: without the inbox the user decides in the terminal as usual
    if (!isWorker && !getState().settings.permissionInbox) return Promise.resolve(null)

    const id = this.nextPermissionId++
    const input = JSON.stringify(toolInput)
    const summary = input.length > 600 ? input.slice(0, 600) + ' …' : input
    const command = typeof toolInput.command === 'string' ? toolInput.command : ''
    const info: PermissionInfo = {
      id,
      agentId: workerId,
      tool,
      summary: (command || summary).slice(0, 800),
      rule: ruleFor(tool, toolInput),
      at: Date.now()
    }
    const waiting = isWorker ? WAITING_FOR_PERMISSION : `Freigabe: ${describeTool(tool, toolInput)}`
    return new Promise((resolve) => {
      const finish = (decision: PermissionDecision | null): void => {
        if (!this.permissions.delete(id)) return
        signal.removeEventListener('abort', onAbort)
        const a = this.running.get(workerId)?.agent
        const more = [...this.permissions.values()].some((p) => p.workerId === workerId)
        if (a?.status === 'needsInput' && a.statusMessage === waiting && !more) {
          this.setStatus(workerId, 'working')
        }
        if (!isWorker) this.emitPermissions()
        resolve(decision)
      }
      const onAbort = (): void => finish(null)
      this.permissions.set(id, {
        workerId,
        kind: isWorker ? 'orchestrator' : 'user',
        info,
        finish
      })
      signal.addEventListener('abort', onAbort)
      this.setStatus(workerId, 'needsInput', waiting)
      if (isWorker) {
        this.deliver(
          lead!,
          `[Permission request #${id} from ${worker.agent.name}] wants to use the tool ` +
            `${tool} with input ${summary}. ` +
            `It is blocked until you answer with the answer_permission tool (request_id ${id}).`
        )
      } else this.emitPermissions()
    })
  }

  /** Open approvals that the user decides in the inbox */
  userPermissions(): PermissionInfo[] {
    return [...this.permissions.values()].filter((p) => p.kind === 'user').map((p) => p.info)
  }

  private emitPermissions(): void {
    this.events.onPermissions(this.userPermissions())
  }

  /**
   * The user's decision: allow, deny (with a reason), always allow (save a rule for the
   * project) or decide in the terminal (claude shows its normal dialog).
   */
  answerUserPermission(id: number, answer: PermissionAnswer, message?: string): void {
    const req = this.permissions.get(id)
    if (!req || req.kind !== 'user') throw new Error('Diese Freigabe ist nicht mehr offen')
    if (answer === 'terminal') return req.finish(null)
    if (answer === 'deny') {
      return req.finish({
        behavior: 'deny',
        message: `Denied by the user: ${message?.trim() || 'not allowed'}`
      })
    }
    if (answer === 'always' && req.info.rule) {
      const projectId = this.running.get(req.workerId)?.agent.projectId
      updateState((s) => {
        const p = s.projects.find((x) => x.id === projectId)
        if (p && !(p.permissionRules ?? []).includes(req.info.rule))
          p.permissionRules = [...(p.permissionRules ?? []), req.info.rule]
      })
    }
    req.finish({ behavior: 'allow' })
  }

  private handleAnswerPermission(agentId: string, args: AnswerPermissionArgs): string {
    const me = this.running.get(agentId)?.agent
    if (me?.teamRole !== 'orchestrator') throw new Error('Only the team orchestrator can do this')
    const id = Math.floor(Number(args.request_id))
    const req = this.permissions.get(id)
    const worker = req && this.running.get(req.workerId)?.agent
    if (!req || !worker || req.kind !== 'orchestrator')
      throw new Error(`No open permission request #${id}`)
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
      r.asking ||
      Date.now() - r.draftAt < DRAFT_HOLD_MS
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
    // Project with worktrees: every worker has its own branch (the name is fixed before it is created)
    const project = state.projects.find((p) => p.id === agent.projectId)
    const branches = project?.useWorktrees
      ? members
          .filter((a) => a.teamRole === 'worker')
          .map((a) => ({ name: a.name, branch: worktreeBranch(a.name, a.id) }))
      : []
    return {
      branches,
      ownBranch: agent.worktree?.branch,
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
    const filePath = isAbsolute(args.file_path)
      ? args.file_path
      : resolvePath(r.cwd, args.file_path)
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
    // Waiting for the user → Windows notification if applicable (workers never wait for the user)
    if (status === 'needsInput' && !isTeamWorker(r.agent)) {
      this.events.onAttention(r.agent, message || 'Benötigt Eingabe')
    }
    // Save the waiting state so that it is shown again after an app restart
    // (only write when it changes – working/idle switch frequently)
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

  /**
   * Remove the agent from the state. `r` (agent that exited regularly): move the session into
   * the history. Tasks go back to the board, an unused worktree is removed.
   */
  private forget(id: string, r?: RunningAgent): void {
    const saved = getState().agents.find((a) => a.id === id)
    const agent = r?.agent
    // Team members cannot be meaningfully continued without their team
    if (r && agent && !agent.engineId && !agent.teamId && sessionExists(agent.sessionId)) {
      const entry: ArchivedSession = {
        id: agent.id,
        projectId: agent.projectId,
        name: agent.name,
        sessionId: agent.sessionId,
        cwd: r.cwd,
        createdAt: agent.createdAt,
        endedAt: Date.now(),
        title: r.title,
        model: agent.model,
        templateId: agent.templateId,
        worktree: agent.worktree,
        usage: agent.usage
      }
      updateState((s) => {
        s.archive = [entry, ...s.archive.filter((x) => x.sessionId !== entry.sessionId)].slice(
          0,
          MAX_ARCHIVE
        )
      })
    }
    // Release this agent's running or queued tasks again
    const taskIds = [
      agent?.currentTaskId ?? saved?.currentTaskId,
      ...(agent?.queue ?? saved?.queue ?? []).map((q) => q.taskId)
    ].filter((t): t is string => !!t)
    for (const taskId of taskIds) {
      this.updateTask(taskId, { status: 'open', agentId: undefined, agentName: undefined })
    }
    updateState((s) => (s.agents = s.agents.filter((a) => a.id !== id)))
    try {
      rmSync(join(dataDir('agents'), id), { recursive: true, force: true })
    } catch {
      // ignore
    }
    // Clean up a worktree without changes and without commits of its own (otherwise it stays for
    // review; when continuing from the history, a removed one is created again)
    const wt = agent?.worktree ?? saved?.worktree
    const shared = wt && this.list().some((a) => a.worktree?.path === wt.path)
    if (wt && !shared) void removeWorktreeIfUnused(wt).catch(noop)
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
  /** Project with worktrees: branch per worker (empty = all share one directory) */
  branches: { name: string; branch: string }[]
  /** The agent's own branch, if it works in a worktree */
  ownBranch?: string
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
    teamRole: a.teamRole,
    worktree: a.worktree,
    engineId: a.engineId,
    forkFrom: a.forkFrom,
    queue: a.queue?.length ? a.queue : undefined,
    currentTaskId: a.currentTaskId
  }
}

/** A project's check commands: one per line, `#` = comment */
function parseChecks(text: string | undefined): string[] {
  return (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

interface CheckFailure {
  command: string
  /** null = timeout or not startable */
  code: number | null
  output: string
}

/** Runs the commands one after another in the working directory; returns the first failure. */
async function runChecks(
  commands: string[],
  cwd: string,
  onStart: (command: string) => void
): Promise<CheckFailure | null> {
  for (const command of commands) {
    onStart(command)
    const failure = await new Promise<CheckFailure | null>((done) => {
      // The user's command line from the project settings → via the shell
      exec(
        command,
        { cwd, windowsHide: true, timeout: CHECK_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (!err) return done(null)
          const out = `${stdout}\n${stderr}`.replace(ANSI, '').trim()
          done({
            command,
            code: typeof err.code === 'number' ? err.code : null,
            output: out.length > 6000 ? '…' + out.slice(-6000) : out || err.message
          })
        }
      )
    })
    if (failure) return failure
  }
  return null
}

/** DevHub note + role/guidelines from the template if any + team context if any. */
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
      team.branches.length
        ? 'Each worker works in its own git worktree (a separate checkout) on its own branch: ' +
          team.branches.map((b) => `${b.name} → ${b.branch}`).join(', ') +
          '. You work in the main checkout. Workers commit on their branch before reporting; integrate their work ' +
          'with `git merge <branch>` (resolve conflicts yourself or send them back), and tell workers to ' +
          '`git merge` your branch when they need changes from others.'
        : 'You all share one working directory: give workers separate files or areas so they do not edit the same files at the same time.',
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
    team.ownBranch
      ? `You work in your own git worktree on the branch \`${team.ownBranch}\` (a separate checkout; other workers do not see your files). ` +
        `Commit your work on this branch before you report – ${team.lead} merges it. Do not switch branches or push.`
      : 'You share one working directory with the other workers: only edit the files/areas assigned to you.',
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
