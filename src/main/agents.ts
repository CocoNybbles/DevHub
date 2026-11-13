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

/** Wird jedem Agent per --append-system-prompt mitgegeben. */
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
  /** Transkript der Session (Pfad aus den Hook-Ereignissen), Quelle der Snippets */
  transcript?: TranscriptReader
  /** Code-Blöcke aus den Antworten, neueste zuerst */
  snippets: CodeSnippet[]
  /** Vom Agent bearbeitete Dateien (Reihenfolge = erste Bearbeitung) */
  edits: EditedFile[]
  /** Worker: hat seit dem letzten Prompt dem Orchestrator berichtet */
  reported: boolean
  /** Arbeitsverzeichnis (Agent-Ordner oder Worktree) */
  cwd: string
  /** Offene `AskUserQuestion`: Eingaben würden sie beantworten → nichts zustellen */
  asking: boolean
  /** Der Zug ist beendet (Stop), der Agent nimmt den nächsten Auftrag an */
  turnDone: boolean
  /** Seit der letzten Anweisung wurde eine Datei geändert → Prüfungen lohnen sich */
  editedThisTurn: boolean
  /** Prüfbefehl, der in diesem Zug zuletzt fehlgeschlagen ist */
  gateFailed?: string
  /** So oft haben die Prüfungen den Agent in diesem Zug schon zurückgeschickt */
  gateRounds: number
  /** Ergebnis der Prüfungen für den Statustext nach dem Stop */
  gateNote?: string
  /** Der Nutzer tippt gerade (unabgeschickter Text im Eingabefeld) – Zeitpunkt der letzten Taste */
  draftAt: number
  /** Letzte Schritte (Tool-Aufrufe), neueste zuerst */
  activityLog: ActivityEntry[]
  /** Kontext-Warnung wurde für diesen Füllstand schon gezeigt */
  contextWarned: boolean
  /** Erste Anweisung des Nutzers (Titel im Verlauf) */
  title?: string
  /** Andere Engine: Timer, der „arbeitet“ nach einer Pause der Ausgabe zurücksetzt */
  quietTimer?: ReturnType<typeof setTimeout>
  /** Zuletzt wurde das Transkript für die Verbrauchsanzeige gelesen */
  usageReadAt: number
}

/** Offene Rechte-Abfrage (claude wartet auf die Hook-Antwort): entscheidet Orchestrator oder Nutzer */
interface PermissionRequest {
  workerId: string
  /** `user`: steht im Eingang des Nutzers */
  kind: 'orchestrator' | 'user'
  info: PermissionInfo
  finish: (decision: PermissionDecision | null) => void
}

/** Höchstens so oft schicken fehlgeschlagene Prüfungen den Agent je Anweisung zurück */
const MAX_GATE_ROUNDS = 3
/** Längste Laufzeit eines Prüfbefehls */
const CHECK_TIMEOUT_MS = 10 * 60_000
/** So lange gilt getippter, nicht abgeschickter Text als Entwurf (danach wird wieder zugestellt) */
const DRAFT_HOLD_MS = 45_000
const MAX_ACTIVITY = 60
const MAX_ARCHIVE = 200
/** Andere Engines: so lange ohne Ausgabe = wartet */
const QUIET_MS = 2500

/** Name des automatisch gestarteten Orchestrators („Orchestrator“, „Orchestrator 2“ …) */
const ORCHESTRATOR_NAME = 'Orchestrator'
/** Statustext eines Workers, solange seine Rechte-Abfrage offen ist */
const WAITING_FOR_PERMISSION = 'Wartet auf Freigabe durch den Orchestrator'

export interface StartTeamOptions {
  /** Team-Vorlage – oder freie Mitgliederliste (temporäres Team) */
  teamTemplateId?: string
  members?: TeamMember[]
  /** Name für temporäre Teams; Standard „Team N“ */
  name?: string
  /** Aufgabe für den Orchestrator */
  task?: string
  /** Modell für alle Mitglieder (per Sprache genannt), hat Vorrang vor den Vorlagen */
  model?: string
}

export interface AgentEvents {
  onData: (id: string, data: string) => void
  onChanged: (agents: Agent[], teams: Team[]) => void
  onCodeFocus: (focus: CodeFocus) => void
  /** Snippet-Liste eines Agents hat sich geändert (vollständig, neueste zuerst) */
  onSnippets: (agentId: string, snippets: CodeSnippet[]) => void
  /** Liste der bearbeiteten Dateien eines Agents hat sich geändert (vollständig) */
  onEdits: (agentId: string, files: EditedFile[]) => void
  /** Agent hat sich direkt nach dem Start mit Fehler beendet */
  onStartFailed: (agentName: string, output: string) => void
  /** Strg+G: Editor-Tab öffnen, vorbelegt mit dem bisherigen Prompt */
  onEditorOpened: (agentId: string, text: string) => void
  /** Text (z. B. Sprachbefehl) an den offenen Editor-Tab anhängen statt ans Terminal */
  onEditorAppend: (agentId: string, text: string) => void
  /** Offene Freigaben für den Eingang des Nutzers haben sich geändert */
  onPermissions: (list: PermissionInfo[]) => void
  /** Hinweis für den Nutzer (notify_user, Kontext-Warnung) */
  onNotice: (notice: UserNotice) => void
  /** Agent wartet jetzt auf den Nutzer (Frage, fertig, Freigabe) → ggf. Benachrichtigung */
  onAttention: (agent: Agent, message: string) => void
  /** Agent hat seinen Zug beendet (für das Vorlesen der Kurzfassung) */
  onTurnFinished: (agent: Agent) => void
  onPlan: (plan: CodePlan) => void
  onShowDiff: (agentId: string, filePath?: string) => void
  onTasksChanged: (tasks: Task[]) => void
  /** MCP-Tools `run_*`: Projekt-Befehle (Ausführen-Fenster) */
  runTool: (
    project: Project,
    tool: 'run_list' | 'run_output' | 'run_start' | 'run_stop',
    args: Record<string, unknown>
  ) => string
}

/** Zusätze beim Start eines Agents (über Name/Modell/Vorlage hinaus) */
export interface StartExtra {
  engineId?: string
  /** Unterhaltung dieser Session als Kopie fortsetzen */
  forkFrom?: string
  /** Vorhandene Session fortsetzen (aus dem Verlauf) */
  sessionId?: string
  /** Name (z. B. der frühere aus dem Verlauf); wird bei Bedarf nummeriert */
  name?: string
  /** Vorhandenen Worktree weiterverwenden (aus dem Verlauf) */
  worktree?: AgentWorktree
  /** Aufgabe aus dem Board, die mit `task` bearbeitet wird */
  taskId?: string
  /** Im Agent-Ordner starten, auch wenn das Projekt Worktrees nutzt */
  noWorktree?: boolean
}

/** Offene Strg+G-Bearbeitung: claude wartet, bis `done` aufgerufen wird */
interface EditorSession {
  filePath: string
  text: string
  done: () => void
}

/** Name des Strg+G-„Editors“ (Wrapper-Skript); muss „notepad“ enthalten, s. writeAgentConfig */
const EDITOR_NAME = 'devhub-notepad'

/** Wartezeit nach dem Schließen des Editors, bis claude den Prompt neu geladen hat */
const EDITOR_RELOAD_MS = 500
/** So lange wartet ein Worker höchstens auf die Entscheidung des Orchestrators (Sekunden) */
const PERMISSION_TIMEOUT_S = 24 * 60 * 60
/** Stop-Hook: Zeit für alle Prüfbefehle zusammen (Sekunden) */
const STOP_TIMEOUT_S = 60 * 60

const noop = (): void => {}

export class AgentManager {
  private running = new Map<string, RunningAgent>()
  private bridge: AgentBridge
  private quitting = false
  /** Wiederherstellung nur einmal pro App-Start */
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
    // Zurückgehaltene Nachrichten nachreichen, sobald der Nutzer nicht mehr tippt
    setInterval(() => {
      for (const r of this.running.values()) {
        if (r.pending.length) this.flushPending(r.agent.id)
        if (r.agent.queue?.length) this.sendNextQueued(r.agent.id)
      }
    }, 5000).unref()
  }

  // ------------------------------------------------------------ Strg+G-Editor-Tab

  /** claude hat für die Prompt-Datei den „Editor“ gestartet → Tab öffnen, warten bis er schließt. */
  private openEditor(agentId: string, filePath: string): Promise<void> {
    const r = this.running.get(agentId)
    if (!r || !filePath || !existsSync(filePath)) return Promise.resolve()
    this.editors.get(agentId)?.done() // Vorherige (hängende) Sitzung freigeben
    const text = readFileSync(filePath, 'utf8')
    return new Promise((done) => {
      this.editors.set(agentId, { filePath, text, done })
      r.agent.editing = true
      this.events.onEditorOpened(agentId, text)
      this.emitChanged()
    })
  }

  /** Anfangstext eines offenen Editor-Tabs (z. B. nach Neuladen der Oberfläche) */
  editorText(agentId: string): string | null {
    return this.editors.get(agentId)?.text ?? null
  }

  /**
   * Editor-Tab schließen. `text`: neuer Prompt (null = unverändert lassen);
   * `submit`: danach abschicken. Erst dann ist der Agent wieder bedienbar.
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
      // Währenddessen angekommene Team-Nachrichten nachreichen
      setTimeout(() => this.flushPending(agentId), submit ? 1000 : 0)
    }, EDITOR_RELOAD_MS)
  }

  /** Editor-Sitzung beenden (claude bekommt die Antwort, liest die Datei neu ein). */
  private closeEditor(agentId: string): void {
    const s = this.editors.get(agentId)
    if (!s) return
    this.editors.delete(agentId)
    s.done()
    const r = this.running.get(agentId)
    if (r) r.agent.editing = false
    this.emitChanged()
  }

  /** Bild aus der Zwischenablage für den Prompt speichern; liefert den Pfad */
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
   * Startet ein Team: automatisch einen Orchestrator + die Mitglieder als Worker, alle mit
   * gemeinsamer teamId. Erst werden alle Agents gespeichert (Namen reserviert, jeder kennt beim Start
   * seine Kollegen), dann gestartet. Die Aufgabe bekommt der Orchestrator, der sie verteilt; Worker
   * sind für den Nutzer nur beobachtbar.
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
    // Fortlaufende Zeitstempel: Reihenfolge bleibt eindeutig, auch nach Neustart
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
        // Worker bekommen je einen eigenen Worktree, der Orchestrator führt im Hauptordner zusammen
        if (agent !== orchestrator) await this.prepareWorktree(agent, project)
        await this.spawn(agent, agent === orchestrator ? opts.task?.trim() || undefined : undefined)
      } catch (e) {
        failures.push(`${agent.name}: ${e instanceof Error ? e.message : String(e)}`)
        updateState((s) => (s.agents = s.agents.filter((a) => a.id !== agent.id)))
        // Ohne Orchestrator ist das Team nicht steuerbar → ganz abbrechen
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
    // Kein einziger Worker läuft → Orchestrator allein ist sinnlos
    if (failures.length === agents.length - 1) {
      this.stopTeam(team.id)
      throw new Error(failures.join('\n'))
    }
    return team
  }

  /** Beendet alle Agents eines Teams (das Team verschwindet mit dem letzten Agent). */
  stopTeam(teamId: string): void {
    for (const a of getState().agents.filter((x) => x.teamId === teamId)) this.kill(a.id)
  }

  /**
   * model: überschreibt `--model` aus Vorlage und Start-Flags (z. B. per Sprachbefehl genannt).
   * templateId: Vorlage → Name „<Vorlage>“ / „<Vorlage> 2“ …, Modell und Anweisung der Vorlage.
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
    // „Agent 3“ aus dem Verlauf nicht als Basis nehmen (ergäbe „Agent 3 2“)
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
    // Erst speichern (reserviert den Namen), dann starten
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

  /** Projekt mit Worktrees: eigenes Arbeitsverzeichnis (eigener Branch) für den neuen Agent anlegen. */
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

  /** Neuer Agent, der die Unterhaltung eines laufenden Agents als Kopie fortsetzt (gleiches Verzeichnis). */
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

  /** Sitzung aus dem Verlauf fortsetzen; `fork`: als Kopie (der Eintrag bleibt im Verlauf). */
  async resumeArchived(id: string, fork = false): Promise<Agent> {
    const entry = getState().archive.find((x) => x.id === id)
    if (!entry) throw new Error('Eintrag nicht gefunden')
    if (!sessionExists(entry.sessionId))
      throw new Error('Das Transkript dieser Sitzung gibt es nicht mehr')
    if (this.list().some((a) => a.sessionId === entry.sessionId))
      throw new Error('Diese Sitzung läuft bereits')
    // Eine Sitzung lässt sich nur in ihrem Verzeichnis fortsetzen → aufgeräumten Worktree neu anlegen
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

  /** Beenden über die Oberfläche: Worker nur mit dem ganzen Team, Orchestrator beendet das Team. */
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
    let r = this.running.get(id)
    if (!r) throw new Error('Agent läuft nicht mehr')
    // Worker sind nur beobachtbar → Anweisung geht an ihren Orchestrator
    if (isTeamWorker(r.agent)) {
      const lead = this.leadOf(r.agent)
      if (!lead) throw new Error(`${r.agent.name} hat keinen laufenden Orchestrator`)
      text = `[Message from the user about ${r.agent.name}] ${text}`
      r = lead
      id = lead.agent.id
    }
    // Editor-Tab offen: Text dort einfügen (Agent selbst ist gesperrt)
    if (r.agent.editing) {
      this.events.onEditorAppend(id, text)
      return false
    }
    const autoSend = r.agent.voiceAutoSend ?? getState().settings.voiceAutoSend
    if (autoSend) await this.typeLine(id, text)
    else r.proc.write(text.replace(/\r?\n/g, ' '))
    return autoSend
  }

  /** Tastatureingaben aus dem Terminal; Editor-Tab offen oder Worker → gesperrt */
  write(id: string, data: string): void {
    const r = this.running.get(id)
    if (!r || r.agent.editing || isTeamWorker(r.agent)) return
    // Entwurf im Eingabefeld erkennen: solange der Nutzer tippt, werden keine automatischen
    // Nachrichten (Team, Warteschlange) dazwischengeschrieben. Enter/Strg+C/Strg+U leeren ihn.
    // eslint-disable-next-line no-control-regex
    if (/[\r\n\x03\x15]/.test(data)) r.draftAt = 0
    // eslint-disable-next-line no-control-regex
    else if (!data.startsWith('\x1b') && /[^\x00-\x1f\x7f]/.test(data)) r.draftAt = Date.now()
    r.proc.write(data)
  }

  /** Zeile vom Nutzer (z. B. `/clear`) – nicht an Worker, die sind nur beobachtbar. */
  async sendLine(id: string, text: string): Promise<void> {
    const a = this.running.get(id)?.agent
    if (a && isTeamWorker(a)) {
      throw new Error(
        `${a.name} kann nur beobachtet werden – Anweisungen gehen an den Orchestrator`
      )
    }
    return this.typeLine(id, text)
  }

  /** Schreibt Text und schickt ihn ab. Enter separat, damit die TUI ihn nicht als Teil eines Paste behandelt. */
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

    // Worktree wurde von Hand entfernt → im Agent-Ordner weiterarbeiten
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
    else if (agent.forkFrom && sessionExists(agent.forkFrom)) {
      // Kopie einer Unterhaltung: alte Session laden, unter der eigenen Id weiterschreiben
      args.push('--resume', agent.forkFrom, '--fork-session', '--session-id', agent.sessionId)
    } else args.push('--session-id', agent.sessionId)
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

    // Strg+G („im Editor bearbeiten“): claude ruft `$EDITOR "<prompt-datei>"` per cmd auf und
    // wartet. EDITOR ist der Wrapper aus writeAgentConfig, gefunden über PATH (Pfad ohne
    // Leerzeichen-Probleme: claude trennt EDITOR an Leerzeichen).
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

  /** Laufenden Prozess registrieren; räumt beim Ende auf (für Claude-Agents und andere Engines). */
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
      // Offener Editor-Tab: Anfrage beantworten, damit ein verwaister curl-Prozess endet
      this.closeEditor(agent.id)
      // Offene Freigaben dieses Agents verfallen
      for (const p of [...this.permissions.values()]) if (p.workerId === agent.id) p.finish(null)
      if (this.quitting) return
      const failed = !r.stopping && exitCode !== 0 && Date.now() - r.startedAt < EARLY_EXIT_MS
      if (failed) this.events.onStartFailed(agent.name, lastLines(r.buffer))
      // Agent wurde im Terminal oder über die Liste beendet → Eintrag entfernen
      this.forget(agent.id, failed ? undefined : r)
      // Ohne Orchestrator ist das Team nicht mehr steuerbar → Worker mit beenden
      if (agent.teamId && agent.teamRole === 'orchestrator') this.stopTeam(agent.teamId)
    })
    return r
  }

  /**
   * Andere Engine (z. B. Codex CLI, Gemini CLI): beliebiges Terminal-Programm im Arbeitsverzeichnis.
   * Ohne Hooks gibt es weder Status noch Datei-Reiter; „arbeitet“ = es kommt gerade Ausgabe.
   */
  private spawnEngine(agent: Agent, command: string, cwd: string, task: string | undefined): void {
    // Befehlszeile des Nutzers unverändert an cmd.exe (ein String → node-pty quotet nicht um)
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
        // Aufgabe eintippen, sobald die Oberfläche der Engine steht
        if (!taskSent) {
          taskSent = true
          void this.typeLine(agent.id, task!).catch(noop)
        }
      }, QUIET_MS)
    })
  }

  /**
   * Pro Agent: Hooks (Status an die App melden) + MCP-Konfiguration (show_code). Worker zusätzlich:
   * Rechte-Abfragen gehen an den Orchestrator (PermissionRequest-Hook wartet auf dessen Antwort),
   * keine Rückfragen an den Nutzer (AskUserQuestion gesperrt – er kann ihnen nicht antworten).
   */
  private writeAgentConfig(agent: Agent): {
    settingsFile: string
    mcpFile: string
    binDir: string
  } {
    const agentId = agent.id
    const worker = isTeamWorker(agent)
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
        // Ohne -m: die Anfrage bleibt offen, solange die Prüfungen des Projekts laufen; die
        // Ausgabe ist die Hook-Antwort (leer = anhalten, `decision: block` = weiterarbeiten)
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
        // Ohne -m: offen, bis entschieden ist – beim Worker durch den Orchestrator, sonst durch
        // eine Projekt-Regel bzw. den Nutzer im Eingang (leere Antwort = normaler Dialog im Terminal)
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

    // Strg+G-„Editor“: schickt den Pfad der Prompt-Datei an DevHub und blockiert, bis der
    // Editor-Tab geschlossen ist. Der Name enthält „notepad“, damit claude ihn als GUI-Editor
    // behandelt: Oberfläche bleibt stehen, Eingabefeld zeigt „Save and close editor to continue…“
    // (bei unbekannten Namen hält claude ihn für einen Terminal-Editor und leert den Bildschirm).
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
    // Jedes Hook-Ereignis nennt das Transkript; Snippets lesen, wenn der Agent etwas gesagt hat
    if (typeof ev.transcript_path === 'string') this.useTranscript(agentId, ev.transcript_path)
    if (
      ev.hook_event_name === 'SessionStart' ||
      ev.hook_event_name === 'Stop' ||
      ev.hook_event_name === 'Notification' ||
      (ev.hook_event_name === 'PreToolUse' && ev.tool_name === 'AskUserQuestion')
    ) {
      this.readSnippets(agentId)
      // Falls die letzte Antwort beim Hook noch nicht im Transkript steht: kurz danach erneut
      if (ev.hook_event_name === 'Stop') setTimeout(() => this.readSnippets(agentId), 1500)
    }
    const r = this.running.get(agentId)
    if (!r) return
    // Buchführung für alle Agents: Zug, offene Frage, Aktivität, geänderte Dateien
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
        // Edit/Write/MultiEdit: Datei sofort rechts als Reiter zeigen
        const edit = editFromToolResult(agentId, ev.tool_response, Date.now())
        if (edit) {
          r.editedThisTurn = true
          this.addEdits(agentId, [edit])
        }
        // Verbrauch/Kontext laufend nachführen (gedrosselt)
        if (Date.now() - r.usageReadAt > 4000) this.readSnippets(agentId)
        break
      }
      case 'Stop':
        r.asking = false
        r.turnDone = true
        r.agent.activity = undefined
        break
    }
    /** Offene Freigabe: Status bleibt stehen, bis entschieden ist */
    const awaitingPermission = [...this.permissions.values()].some((p) => p.workerId === agentId)
    // Worker warten nie auf den Nutzer (er kann ihnen nicht antworten): fertig = untätig
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
            r.reported = true // nur einmal pro Auftrag erinnern
          }
          return
        case 'Notification':
          return
      }
    }
    switch (ev.hook_event_name) {
      case 'SessionStart':
        // Beim Fortsetzen (Wiederherstellung) den gespeicherten Wartezustand behalten
        if (ev.source === 'resume' && this.running.get(agentId)?.agent.status === 'needsInput')
          break
        this.setStatus(agentId, 'idle')
        break
      case 'PostToolUse':
        // Offene Rechte-Abfrage bleibt sichtbar, bis sie entschieden ist
        if (!awaitingPermission) this.setStatus(agentId, 'working')
        break
      case 'UserPromptSubmit':
        this.setStatus(agentId, 'working')
        break
      case 'PreToolUse':
        // AskUserQuestion wartet auf den Nutzer, alle anderen Tools = Arbeit
        if (ev.tool_name === 'AskUserQuestion') {
          this.setStatus(agentId, 'needsInput', 'Stellt eine Frage')
        } else if (!awaitingPermission) {
          this.setStatus(agentId, 'working')
        }
        break
      case 'Notification':
        // Die Freigabe steht schon im Eingang (claudes Hinweis dazu würde den Text ersetzen)
        if (!awaitingPermission) {
          this.setStatus(agentId, 'needsInput', ev.message || 'Benötigt Eingabe')
        }
        break
      case 'Stop':
        this.setStatus(agentId, 'needsInput', r.gateNote ?? 'Fertig – wartet auf Eingabe')
        break
    }
  }

  // ------------------------------------------------------------ Fertig-Meldung: Prüfungen, Warteschlange

  /**
   * Stop-Hook: Hat der Agent in diesem Zug Dateien geändert und das Projekt Prüfbefehle, laufen
   * sie jetzt. Schlägt einer fehl, bekommt der Agent die Ausgabe als Grund zum Weiterarbeiten
   * (höchstens MAX_GATE_ROUNDS-mal je Anweisung). Danach: Status, Aufgabe erledigt, nächster Auftrag.
   */
  private async handleStop(agentId: string, ev: HookEvent): Promise<object | null> {
    const r = this.running.get(agentId)
    if (!r) return null
    const project = getState().projects.find((p) => p.id === r.agent.projectId)
    const checks = parseChecks(project?.checks)
    r.gateNote = undefined
    // Seit dem letzten Fehlschlag nichts geändert (der Agent hat z. B. erklärt, warum er nicht
    // korrigiert) → nicht noch einmal prüfen und zurückschicken
    if (checks.length && !r.editedThisTurn && r.gateFailed) {
      r.gateNote = `Fertig – Prüfung „${r.gateFailed}“ schlägt fehl`
    }
    if (checks.length && r.editedThisTurn) {
      // Nur neue Änderungen lösen die nächste Prüfung aus
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

  /** Zug beendet: Aufgabe abhaken, nächsten Auftrag der Warteschlange schicken, ggf. vorlesen. */
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
    // Erst nach dem zweiten Lesen des Transkripts steht die letzte Antwort sicher drin
    setTimeout(() => {
      if (this.running.get(agent.id) === r && r.turnDone) this.events.onTurnFinished(agent)
    }, 2200)
  }

  /** Nächsten Auftrag abschicken, sobald der Agent frei ist (sonst später erneut versucht). */
  private sendNextQueued(id: string): void {
    const r = this.running.get(id)
    if (!r || !r.agent.queue?.length) return
    // Andere Engines melden kein „fertig“ → sofort eintippen
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

  /** Auftrag anhängen – wird abgeschickt, sobald der Agent fertig ist (sofort, wenn er frei ist). */
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

  // ------------------------------------------------------------ Aufgaben (Board)

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
    // Auch aus Warteschlangen nehmen
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

  /** Neuen Agent starten, der die Aufgabe bearbeitet */
  async startTask(id: string, templateId?: string): Promise<Agent> {
    const task = getState().tasks.find((t) => t.id === id)
    if (!task) throw new Error('Aufgabe nicht gefunden')
    const agent = await this.start(task.projectId, task.text, undefined, templateId, { taskId: id })
    this.updateTask(id, { status: 'running', agentId: agent.id, agentName: agent.name })
    return agent
  }

  /** Aufgabe einem laufenden Agent geben (er bearbeitet sie, sobald er frei ist) */
  assignTask(id: string, agentId: string): void {
    const task = getState().tasks.find((t) => t.id === id)
    const agent = this.running.get(agentId)?.agent
    if (!task || !agent) throw new Error('Aufgabe oder Agent nicht gefunden')
    this.updateTask(id, { status: 'open', agentId: agent.id, agentName: agent.name })
    this.enqueue(agentId, task.text, id)
  }

  // ------------------------------------------------------------ Aktivität

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

  /** Verlauf: beendete Sitzungen, neueste zuerst */
  archive(): ArchivedSession[] {
    return getState().archive
  }

  removeArchived(id: string): void {
    updateState((s) => (s.archive = s.archive.filter((x) => x.id !== id)))
  }

  /** Snippets aller laufenden Agents (für die Oberfläche nach einem Neuladen) */
  snippets(): Record<string, CodeSnippet[]> {
    return Object.fromEntries([...this.running].map(([id, r]) => [id, r.snippets]))
  }

  /** Bearbeitete Dateien aller laufenden Agents (für die Oberfläche nach einem Neuladen) */
  edits(): Record<string, EditedFile[]> {
    return Object.fromEntries([...this.running].map(([id, r]) => [id, r.edits]))
  }

  private addEdits(agentId: string, added: EditedFile[]): void {
    const r = this.running.get(agentId)
    if (!r || !added.length) return
    const merged = mergeEdits(r.edits, added)
    // Transkript wiederholt, was der Hook schon gemeldet hat → nur bei echter Änderung melden
    if (merged.length === r.edits.length && merged.every((e, i) => e === r.edits[i])) return
    r.edits = merged
    this.events.onEdits(agentId, r.edits)
  }

  private useTranscript(agentId: string, path: string): void {
    const r = this.running.get(agentId)
    if (r && r.transcript?.path !== path) r.transcript = new TranscriptReader(path, agentId)
  }

  /** Neue Code-Blöcke aus dem Transkript übernehmen und melden. */
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
        // Nach einer Wiederherstellung kommen die bearbeiteten Dateien aus dem Transkript
        this.addEdits(agentId, edits)
        if (!snippets.length) return
        r.snippets = mergeSnippets(r.snippets, snippets)
        this.events.onSnippets(agentId, r.snippets)
      })
      .catch((e) => console.error('[DevHub] Transkript nicht lesbar:', e))
  }

  /** Einmal warnen, wenn der Kontext die eingestellte Schwelle überschreitet */
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

  /** Orchestrator des Teams (bzw. Leitung älterer Teams), falls er läuft */
  private leadOf(agent: Agent): RunningAgent | undefined {
    if (!agent.teamId) return undefined
    const lead = teamLead(this.list(), agent.teamId)
    return lead && lead.id !== agent.id ? this.running.get(lead.id) : undefined
  }

  /**
   * PermissionRequest eines Workers: an den Orchestrator weiterreichen und auf dessen Entscheidung
   * (`answer_permission`) warten. Bricht die Verbindung ab (Worker beendet), verfällt die Anfrage.
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
    // Regeln des Projekts („Immer erlauben“) entscheiden sofort – für alle Agents
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
    // Normale Agents: ohne Eingang entscheidet der Nutzer wie gewohnt im Terminal
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

  /** Offene Freigaben, die der Nutzer im Eingang entscheidet */
  userPermissions(): PermissionInfo[] {
    return [...this.permissions.values()].filter((p) => p.kind === 'user').map((p) => p.info)
  }

  private emitPermissions(): void {
    this.events.onPermissions(this.userPermissions())
  }

  /**
   * Entscheidung des Nutzers: erlauben, ablehnen (mit Begründung), immer erlauben (Regel fürs
   * Projekt speichern) oder im Terminal entscheiden (claude zeigt seinen normalen Dialog).
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
   * Text als neuen Prompt an einen Agent geben – zurückhalten, solange er nicht bereit ist
   * (startet, Editor-Tab offen, offene Rückfrage an den Nutzer, die Eingaben beantworten würden).
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
   * Nachricht an Teamkollegen: wird als neuer Prompt in deren Terminal geschrieben (Claude Code
   * stellt sie in die Warteschlange, falls der Agent gerade arbeitet). Nur innerhalb des Teams.
   */
  private async handleTeamMessage(agentId: string, args: TeamMessageArgs): Promise<string> {
    const me = this.running.get(agentId)
    if (!me?.agent.teamId) throw new Error('You are not part of a team')
    const message = String(args.message ?? '').trim()
    const to = String(args.to ?? '').trim()
    if (!message || !to) throw new Error('"to" and "message" are required')

    // Worker sprechen nur mit dem Orchestrator (er verteilt und sammelt alles)
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
      // Nicht bereit (startet, Editor-Tab, offene Rückfrage) → wird später zugestellt
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
    const lead = teamLead(members, team.id)
    const orchestrated = lead?.teamRole === 'orchestrator'
    // Projekt mit Worktrees: jeder Worker hat einen eigenen Branch (Name steht vor dem Anlegen fest)
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
    // Wartet auf den Nutzer → ggf. Windows-Benachrichtigung (Worker warten nie auf ihn)
    if (status === 'needsInput' && !isTeamWorker(r.agent)) {
      this.events.onAttention(r.agent, message || 'Benötigt Eingabe')
    }
    // Wartezustand speichern, damit er nach einem App-Neustart wieder angezeigt wird
    // (nur schreiben, wenn er sich ändert – working/idle wechseln häufig)
    const needsInput = status === 'needsInput' ? (message ?? '') : undefined
    const saved = getState().agents.find((x) => x.id === id)
    if (saved && saved.needsInput !== needsInput) {
      updateState(() => (saved.needsInput = needsInput))
    }
    this.flushPending(id)
    this.emitChanged()
  }

  /** Zurückgehaltene Team-Nachrichten zustellen, sobald die TUI bereit und kein Editor-Tab offen ist */
  private flushPending(id: string): void {
    const r = this.running.get(id)
    if (!r || this.mustHold(r) || !r.pending.length) return
    const queued = r.pending.splice(0)
    void (async () => {
      for (const text of queued) await this.typeLine(id, text).catch(() => {})
    })()
  }

  /**
   * Agent aus dem Zustand entfernen. `r` (regulär beendeter Agent): Sitzung in den Verlauf
   * übernehmen. Aufgaben gehen zurück ins Board, ein unbenutzter Worktree wird entfernt.
   */
  private forget(id: string, r?: RunningAgent): void {
    const saved = getState().agents.find((a) => a.id === id)
    const agent = r?.agent
    // Teammitglieder sind ohne ihr Team nicht sinnvoll fortsetzbar
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
    // Laufende bzw. eingereihte Aufgaben dieses Agents wieder freigeben
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
      // ignorieren
    }
    // Worktree ohne Änderungen und ohne eigene Commits aufräumen (sonst bleibt er zum Prüfen stehen;
    // beim Fortsetzen aus dem Verlauf wird ein entfernter wieder angelegt)
    const wt = agent?.worktree ?? saved?.worktree
    const shared = wt && this.list().some((a) => a.worktree?.path === wt.path)
    if (wt && !shared) void removeWorktreeIfUnused(wt).catch(noop)
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
  /** Name des Orchestrators (bzw. bei älteren Teams des leitenden, ersten Mitglieds) */
  lead: string
  /** Team mit Orchestrator (sonst älteres Team: erstes Mitglied leitet, alle reden miteinander) */
  orchestrated: boolean
  /** Übrige Mitglieder (ohne den Agent selbst, bei Teams mit Orchestrator ohne diesen) */
  teammates: string[]
  instructions?: string
  /** Projekt mit Worktrees: Branch je Worker (leer = alle teilen sich ein Verzeichnis) */
  branches: { name: string; branch: string }[]
  /** Branch des Agents selbst, falls er in einem Worktree arbeitet */
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

/** Prüfbefehle eines Projekts: einer je Zeile, `#` = Kommentar */
function parseChecks(text: string | undefined): string[] {
  return (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

interface CheckFailure {
  command: string
  /** null = Zeitüberschreitung oder nicht startbar */
  code: number | null
  output: string
}

/** Führt die Befehle nacheinander im Arbeitsverzeichnis aus; liefert den ersten Fehlschlag. */
async function runChecks(
  commands: string[],
  cwd: string,
  onStart: (command: string) => void
): Promise<CheckFailure | null> {
  for (const command of commands) {
    onStart(command)
    const failure = await new Promise<CheckFailure | null>((done) => {
      // Befehlszeile des Nutzers aus den Projekt-Einstellungen → über die Shell
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

/** Team mit Orchestrator: Rolle des Orchestrators bzw. eines Workers. */
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
