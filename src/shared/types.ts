/** Types shared by the main, preload and renderer processes. */

export type ClaudeAuthState =
  | { kind: 'notInstalled' }
  | { kind: 'loggedOut'; reason?: string }
  | { kind: 'loggedIn'; authMethod?: string; loginExpiresAt?: string; subscriptionType?: string }
  | { kind: 'error'; message: string }

export interface Project {
  id: string
  name: string
  /** Path 1: working directory in which agents are started */
  agentPath: string
  /** Path 2: .sln / project file (e.g. for Visual Studio, Rider …) */
  projectFile?: string
  /** Program (path to the .exe) for the project file; empty = global setting */
  projectFileApp?: string
  /** Path 3: folder opened in an editor (formerly `vscodePath`, migrated on load) */
  folderPath?: string
  /** Program (path to the .exe) for the folder; empty = global setting */
  folderApp?: string
  /** Extra start flags for this project's agents (extend/override the global ones) */
  agentArgs?: string
  /** Jeder neue Agent arbeitet in einem eigenen Git-Worktree (eigener Branch) statt im Agent-Ordner */
  useWorktrees?: boolean
  /** Prüfbefehle (einer je Zeile), die laufen, wenn ein Agent nach Änderungen fertig meldet */
  checks?: string
  /** Befehle für das Ausführen-Fenster (Dev-Server, Tests …) */
  runCommands?: RunCommand[]
  /** Adresse der Web-Vorschau, z. B. http://localhost:5173 */
  previewUrl?: string
  /** Automatisch erlaubte Tool-Aufrufe: `Tool` oder `Bash:<Befehlsanfang>` */
  permissionRules?: string[]
}

/** Benannter Befehl eines Projekts (läuft im Agent-Ordner) */
export interface RunCommand {
  name: string
  command: string
}

/** Zustand eines Projekt-Befehls im Ausführen-Fenster */
export interface RunInfo {
  projectId: string
  name: string
  command: string
  running: boolean
  /** Exit-Code des letzten Laufs (undefined = noch nie gelaufen) */
  exitCode?: number | null
  startedAt?: number
}

export type ProjectInput = Omit<Project, 'id'> & { id?: string }

/** Project folder found during import */
export interface ScannedProject {
  path: string
  /** Suggestion: folder name */
  name: string
  /** What it was recognized by (e.g. "Git", ".sln", "Node") */
  marker: string
  /** Automatically found .sln/.slnx (null = none) */
  projectFile: string | null
  /** Folder is already registered as a project */
  registered: boolean
}

/**
 * starting   – process started, no feedback yet
 * working    – agent is working
 * idle       – ready, no task yet
 * needsInput – waiting for answer/permission/next instruction → highlighted on the left
 */
export type AgentStatus = 'starting' | 'working' | 'idle' | 'needsInput'

export interface Agent {
  id: string
  projectId: string
  name: string
  /** Claude session ID (for --session-id / --resume) */
  sessionId: string
  status: AgentStatus
  statusMessage?: string
  createdAt: number
  /** Auto-send voice text: overrides `Settings.voiceAutoSend`, undefined = global */
  voiceAutoSend?: boolean
  /** Model set at start (`--model`, e.g. via voice command), takes precedence over template and start flags */
  model?: string
  /** Template the agent was started from (model + instructions are read on every start) */
  templateId?: string
  /** Running team the agent belongs to (members may send each other messages) */
  teamId?: string
  /**
   * Role in the team: `orchestrator` (started with every team, the user's only point of
   * contact) or `worker` (observe only, no input). Missing for teams from older states.
   */
  teamRole?: TeamRole
  /** Ctrl+G: instruction is being written in the editor tab → agent locked elsewhere (not persisted) */
  editing?: boolean
  /** Eigener Git-Worktree des Agents (Projekt mit `useWorktrees`) */
  worktree?: AgentWorktree
  /** Andere Engine als Claude Code (Einstellungen → Weitere Engines); ohne Hooks/Status */
  engineId?: string
  /** Session, von der beim ersten Start abgezweigt wird (`--fork-session`) */
  forkFrom?: string
  /** Aufträge, die nacheinander abgeschickt werden, sobald der Agent fertig ist */
  queue?: QueuedPrompt[]
  /** Aufgabe (Board), an der der Agent gerade arbeitet */
  currentTaskId?: string
  /** Was der Agent gerade tut (aus den Tool-Hooks, nicht gespeichert) */
  activity?: string
  /** Vom Agent gemeldeter Fortschritt (MCP `report_progress`, nicht gespeichert) */
  progress?: AgentProgress
  /** Token-Verbrauch aus dem Transkript (nicht gespeichert) */
  usage?: AgentUsage
  /** Anfang der letzten Antwort (für Eingang, Fernzugriff, Vorlesen; nicht gespeichert) */
  lastMessage?: string
}

export interface AgentWorktree {
  /** Wurzel des Worktrees */
  path: string
  branch: string
  /** Branch/Commit, von dem abgezweigt wurde */
  base: string
  /** Wurzel des Haupt-Repositorys */
  repo: string
}

export interface QueuedPrompt {
  id: string
  text: string
  taskId?: string
}

export interface AgentProgress {
  /** 0–100, undefined = ohne Balken */
  percent?: number
  message: string
}

export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface AgentUsage {
  /** Tokens im Kontext bei der letzten Antwort (Eingabe + Cache) */
  context: number
  total: TokenTotals
  /** Verbrauch je Tag (`YYYY-MM-DD`, lokale Zeit) */
  byDay: Record<string, TokenTotals>
  model?: string
}

/** Ein Schritt des Agents (Tool-Aufruf) für die Aktivitätsliste */
export interface ActivityEntry {
  at: number
  text: string
}

/** Offene Freigabe, die der Nutzer im Eingang entscheidet */
export interface PermissionInfo {
  id: number
  agentId: string
  tool: string
  /** Gekürzte Eingabe des Tools */
  summary: string
  /** Regel, die „Immer erlauben“ für das Projekt speichern würde */
  rule: string
  at: number
}

export type PermissionAnswer = 'allow' | 'deny' | 'always' | 'terminal'

/** Hinweis eines Agents bzw. von DevHub (MCP `notify_user`, Kontext-Warnung …) */
export interface UserNotice {
  id: number
  agentId?: string
  message: string
  at: number
}

/** Vom Agent gezeigter Plan/Text (MCP `show_plan`), rechts als Reiter */
export interface CodePlan {
  agentId: string
  title: string
  markdown: string
  at: number
}

export type TaskStatus = 'open' | 'running' | 'done'

/** Aufgabe im Board eines Projekts */
export interface Task {
  id: string
  projectId: string
  text: string
  status: TaskStatus
  /** Agent, der sie bearbeitet (hat) */
  agentId?: string
  agentName?: string
  createdAt: number
  doneAt?: number
}

/** Beendete Sitzung im Verlauf (fortsetzbar, solange das Transkript existiert) */
export interface ArchivedSession {
  /** frühere Agent-Id */
  id: string
  projectId: string
  name: string
  sessionId: string
  /** Arbeitsverzeichnis der Sitzung (nur dort lässt sie sich fortsetzen) */
  cwd: string
  createdAt: number
  endedAt: number
  /** Erste Anweisung des Nutzers (gekürzt) */
  title?: string
  model?: string
  templateId?: string
  worktree?: AgentWorktree
  usage?: AgentUsage
}

/** Treffer der Volltextsuche über die Transkripte */
export interface SessionMatch {
  sessionId: string
  name: string
  projectId: string
  /** Laufender Agent (dann `agentId`), sonst Eintrag im Verlauf (`archivedId`) */
  agentId?: string
  archivedId?: string
  excerpts: string[]
}

export type GitChangeKind = 'modified' | 'added' | 'deleted' | 'untracked'

export interface GitFileChange {
  /** Pfad relativ zur Wurzel des Arbeitsverzeichnisses, mit `/` */
  path: string
  kind: GitChangeKind
}

/** Arbeitsverzeichnis, dessen Änderungen geprüft werden können (Hauptordner oder Worktree) */
export interface ReviewTarget {
  id: string
  label: string
  cwd: string
  isWorktree: boolean
  branch?: string
  base?: string
  /** Laufender Agent in diesem Verzeichnis */
  agentId?: string
}

export interface ReviewInfo {
  isRepo: boolean
  /** Fehlermeldung, falls git fehlt o. Ä. */
  error?: string
  targets: ReviewTarget[]
}

export interface GitDiff {
  original: string
  modified: string
  binary?: boolean
}

/** Wiederverwendbare Anweisung; Platzhalter `{{name}}` werden beim Senden abgefragt */
export interface PromptTemplate {
  id: string
  name: string
  text: string
}

export type PromptTemplateInput = Omit<PromptTemplate, 'id'> & { id?: string }

/** Andere Coding-Engine als Claude Code: läuft als Terminal-Programm ohne Hooks */
export interface Engine {
  id: string
  name: string
  /** Befehlszeile, z. B. `codex` oder `gemini` */
  command: string
}

export type EngineInput = Omit<Engine, 'id'> & { id?: string }

export interface StartOptions {
  task?: string
  templateId?: string
  engineId?: string
}

export interface RemoteInfo {
  running: boolean
  /** Adressen fürs Handy (mit Token) */
  urls: string[]
  error?: string
}

export type TeamRole = 'orchestrator' | 'worker'

/** Team member that can only be observed (tasks come exclusively from the orchestrator) */
export const isTeamWorker = (a: Pick<Agent, 'teamRole'>): boolean => a.teamRole === 'worker'

/** Orchestrator of a team; older teams without orchestrator: first started member (lead) */
export function teamLead<A extends Pick<Agent, 'teamId' | 'teamRole' | 'createdAt'>>(
  agents: A[],
  teamId: string
): A | undefined {
  const members = agents.filter((a) => a.teamId === teamId)
  return (
    members.find((a) => a.teamRole === 'orchestrator') ??
    [...members].sort((a, b) => a.createdAt - b.createdAt)[0]
  )
}

/** Member of a team template: predefined agent or (without templateId) normal agent. */
export interface TeamMember {
  templateId?: string
}

/** Predefined team made of predefined agents (settings). */
export interface TeamTemplate {
  id: string
  name: string
  /** Executing agents; an orchestrator that directs them is always started automatically in addition */
  members: TeamMember[]
  /** Shared guidelines for all members (e.g. workflow, hand-offs) */
  instructions?: string
}

export type TeamTemplateInput = Omit<TeamTemplate, 'id'> & { id?: string }

/** Running team in a project (from a team template or temporary via voice). */
export interface Team {
  id: string
  name: string
  projectId: string
  /** Team template (guidelines are read on every start); missing for temporary teams */
  teamTemplateId?: string
  temporary: boolean
  createdAt: number
}

/** Predefined, named agent (e.g. "Entwickler") – startable via voice or the list. */
export interface AgentTemplate {
  id: string
  /** Unique; started agents get this name ("Name 2", "Name 3" … if needed) */
  name: string
  /** `--model` (alias or full name); empty = start flags. A model named by voice takes precedence. */
  model?: string
  /** Role/guidelines, appended to the system prompt */
  instructions?: string
}

export type AgentTemplateInput = Omit<AgentTemplate, 'id'> & { id?: string }

/** Code location reported by an agent via the MCP tool `show_code`. */
export interface CodeFocus {
  agentId: string
  filePath: string
  startLine: number
  endLine: number
  note?: string
  at: number
}

/** Code block from an agent reply (from the transcript), shown on the right with a copy button. */
export interface CodeSnippet {
  /** `<message-uuid>-<n>` */
  id: string
  agentId: string
  /** Language from the code fence (```sql), lowercase; '' = none given */
  language: string
  code: string
  /** Time of the reply (ms) */
  at: number
}

/** Line range (1-based, inclusive) */
export interface LineRange {
  start: number
  end: number
}

/** File edited by the agent (Edit/Write/MultiEdit), shown on the right as its own tab. */
export interface EditedFile {
  agentId: string
  filePath: string
  /** Time of the last change (ms) */
  at: number
  /** Changed lines of the last change (empty = unknown or newly created) */
  changedLines: LineRange[]
  /** Last change created the file */
  created?: boolean
}

export type WhisperModelId = 'base' | 'small' | 'large-v3-turbo'

export interface WhisperModelInfo {
  id: WhisperModelId
  label: string
  sizeMB: number
  description: string
  installed: boolean
}

export interface VoiceStatus {
  /** whisper.cpp program present */
  engineInstalled: boolean
  models: WhisperModelInfo[]
  /** Active, installed model – null = voice control not ready yet */
  activeModel: WhisperModelId | null
}

export interface DownloadProgress {
  phase: 'engine' | 'model' | 'done' | 'error'
  receivedBytes: number
  totalBytes: number
  message?: string
}

export type VoiceCommandResult =
  /** sent = false: only typed into the terminal (auto-send off) */
  | { kind: 'sent'; agentName: string; message: string; sent: boolean }
  | {
      kind: 'started'
      agentName: string
      projectName: string
      task?: string
      model?: string
      /** Name of the template used */
      template?: string
    }
  | {
      kind: 'teamStarted'
      teamName: string
      projectName: string
      temporary: boolean
      agentNames: string[]
      task?: string
    }
  | { kind: 'none'; message: string }

export interface Settings {
  voiceModel: WhisperModelId | null
  /** Send transcribed text right away with Enter */
  voiceAutoSend: boolean
  /** Shortcut (Electron accelerator, see shared/hotkeys.ts): recording for the active agent, in-app only */
  hotkeyAgentVoice: string
  /** Shortcut: global voice command, system-wide via globalShortcut */
  hotkeyGlobalVoice: string
  /** Shortcut (in-app): write an instruction for the active agent in the editor tab */
  hotkeyEditor: string
  /** Extra start flags for all agents, e.g. `--permission-mode auto` (see shared/agentArgs.ts) */
  agentArgs: string
  /** Program (path to the .exe) for project files; empty = Windows default program for the extension */
  projectFileApp: string
  /** Program (path to the .exe) for project folders; empty = VS Code (if installed), otherwise Explorer */
  folderApp: string
  /** Remember the last detected language and force it first on the next recording (faster) */
  voiceRememberLanguage: boolean
  /** Remembered language (whisper code, e.g. "de"), null = none yet; English is never remembered */
  voiceLanguage: string | null
  /** Fixed language for voice input (whisper code), null = detect automatically */
  voiceFixedLanguage: string | null
  /** File preview: show files edited by the active agent as tabs on the right */
  showEditedFiles: boolean
  /** Windows-Benachrichtigung + Taskleisten-Blinken, wenn ein Agent wartet und DevHub im Hintergrund ist */
  notifyOnWaiting: boolean
  /** Freigaben im Eingang entscheiden statt im Terminal des Agents */
  permissionInbox: boolean
  /** Fertige Agents: Kurzfassung der Antwort vorlesen */
  voiceReadback: boolean
  /** Ab so vielen Tokens im Kontext warnen (0 = nie) */
  contextWarnTokens: number
  /** Preise in USD je Million Tokens für die Kostenschätzung (0 = keine Kostenanzeige) */
  priceInput: number
  priceOutput: number
  /** Fernzugriff im lokalen Netz (Handy): Agents sehen, antworten, Freigaben entscheiden */
  remoteEnabled: boolean
  remotePort: number
  /** Geheimer Teil der Adresse; wird beim ersten Einschalten erzeugt */
  remoteToken: string
}

export interface TranscribeResult {
  text: string
  /** Detected or used language (whisper code) */
  language: string
  /** true = remembered language was used (without automatic detection) */
  remembered: boolean
}

/** View in the center; saved and restored on app start. */
export type Selection =
  | { kind: 'agent'; agentId: string }
  | { kind: 'project'; projectId: string; activeAgentId?: string }
  /** Freely assembled grid (Ctrl+click), also across projects */
  | { kind: 'agents'; agentIds: string[]; activeAgentId?: string }
  | null

export type FileReadResult = { ok: true; content: string } | { ok: false; error: string }

type Unsubscribe = () => void

export interface DevHubApi {
  claude: {
    checkAuth: () => Promise<ClaudeAuthState>
    startLogin: () => Promise<void>
  }
  tools: {
    vscodeInstalled: () => Promise<boolean>
  }
  projects: {
    list: () => Promise<Project[]>
    save: (input: ProjectInput) => Promise<Project>
    remove: (id: string) => Promise<void>
    /** New order (ids in display order); returns the sorted list */
    reorder: (ids: string[]) => Promise<Project[]>
    /** Folder picker with multi-select (Ctrl+click) for import */
    pickFolders: () => Promise<string[]>
    /** Scans folders for projects (incl. subfolders, project file search) */
    scan: (dirs: string[]) => Promise<ScannedProject[]>
    openProjectFile: (id: string) => Promise<void>
    /** Open folder (path 3): program project → global → VS Code → Explorer */
    openFolder: (id: string) => Promise<void>
    pickFolder: (defaultPath?: string) => Promise<string | null>
    pickProjectFile: (defaultPath?: string) => Promise<string | null>
    /** Searches the folder (up to 3 levels deep) for a .sln/.slnx; null if none. */
    findSolution: (dir: string) => Promise<string | null>
    /** File picker for a program (.exe/.cmd/.bat) */
    pickProgram: (defaultPath?: string) => Promise<string | null>
  }
  agents: {
    list: () => Promise<Agent[]>
    /** Restores the agents of the last session on app start. */
    restore: () => Promise<void>
    /** templateId: aus einer Vorlage starten; engineId: andere Engine als Claude Code */
    start: (projectId: string, options?: StartOptions) => Promise<Agent>
    /** Neuer Agent, der die Unterhaltung dieses Agents als Kopie fortsetzt */
    fork: (id: string) => Promise<Agent>
    /** Auftrag anhängen: wird abgeschickt, sobald der Agent fertig ist (sofort, wenn er frei ist) */
    enqueue: (id: string, text: string) => Promise<void>
    dequeue: (id: string, queueId: string) => Promise<void>
    /** Letzte Schritte (Tool-Aufrufe) des Agents, neueste zuerst */
    activityLog: (id: string) => Promise<ActivityEntry[]>
    /** Benachrichtigung angeklickt → diesen Agent zeigen */
    onFocusRequest: (cb: (agentId: string) => void) => Unsubscribe
    stop: (id: string) => Promise<void>
    rename: (id: string, name: string) => Promise<void>
    /** New order of a group (agents of a project/team); others stay in place */
    reorder: (ids: string[]) => Promise<void>
    write: (id: string, data: string) => void
    /** Send text as an instruction (text + Enter). */
    sendLine: (id: string, text: string) => Promise<void>
    /** Send voice text or just type it in, depending on the setting (agent, else global); true = sent */
    sendVoice: (id: string, text: string) => Promise<boolean>
    /** undefined = use the global setting */
    setVoiceAutoSend: (id: string, value: boolean | undefined) => Promise<void>
    resize: (id: string, cols: number, rows: number) => void
    /** Terminal output so far (e.g. after reloading the UI). */
    buffer: (id: string) => Promise<string>
    onData: (cb: (id: string, data: string) => void) => Unsubscribe
    /** Agents and running teams have changed */
    onChanged: (cb: (agents: Agent[], teams: Team[]) => void) => Unsubscribe
    /** Agent exited with an error right after start (e.g. invalid start flag) */
    onStartFailed: (cb: (agentName: string, output: string) => void) => Unsubscribe
  }
  code: {
    readFile: (path: string) => Promise<FileReadResult>
    openInVSCode: (path: string, line: number) => Promise<void>
    onFocus: (cb: (focus: CodeFocus) => void) => Unsubscribe
    /** Snippets of all running agents (newest first), e.g. after reloading the UI */
    snippets: () => Promise<Record<string, CodeSnippet[]>>
    /** An agent's snippet list has changed (full list, newest first) */
    onSnippets: (cb: (agentId: string, snippets: CodeSnippet[]) => void) => Unsubscribe
    /** Edited files of all running agents (order = first edit) */
    edits: () => Promise<Record<string, EditedFile[]>>
    /** An agent's list of edited files has changed (full list) */
    onEdits: (cb: (agentId: string, files: EditedFile[]) => void) => Unsubscribe
    /** Agent zeigt einen Plan/Text (MCP `show_plan`) */
    onPlan: (cb: (plan: CodePlan) => void) => Unsubscribe
    /** Agent bittet, seine Änderungen zu prüfen (MCP `show_diff`) */
    onShowDiff: (cb: (agentId: string, filePath?: string) => void) => Unsubscribe
  }
  /** Eingang: Freigaben und Hinweise */
  inbox: {
    permissions: () => Promise<PermissionInfo[]>
    answer: (id: number, answer: PermissionAnswer, message?: string) => Promise<void>
    onPermissions: (cb: (list: PermissionInfo[]) => void) => Unsubscribe
    onNotice: (cb: (notice: UserNotice) => void) => Unsubscribe
  }
  tasks: {
    list: () => Promise<Task[]>
    save: (input: { id?: string; projectId: string; text: string }) => Promise<Task>
    remove: (id: string) => Promise<void>
    setStatus: (id: string, status: TaskStatus) => Promise<void>
    /** Neuen Agent mit der Aufgabe starten */
    start: (id: string, templateId?: string) => Promise<Agent>
    /** Aufgabe einem laufenden Agent in die Warteschlange legen */
    assign: (id: string, agentId: string) => Promise<void>
    onChanged: (cb: (tasks: Task[]) => void) => Unsubscribe
  }
  history: {
    list: () => Promise<ArchivedSession[]>
    remove: (id: string) => Promise<void>
    /** Sitzung als Agent fortsetzen (fork = als Kopie, das Original bleibt im Verlauf) */
    resume: (id: string, fork?: boolean) => Promise<Agent>
    search: (query: string) => Promise<SessionMatch[]>
  }
  git: {
    targets: (projectId: string) => Promise<ReviewInfo>
    changes: (projectId: string, targetId: string) => Promise<GitFileChange[]>
    diff: (projectId: string, targetId: string, path: string) => Promise<GitDiff>
    saveFile: (projectId: string, targetId: string, path: string, content: string) => Promise<void>
    discard: (projectId: string, targetId: string, path: string) => Promise<void>
    /** paths leer = alle Änderungen; liefert die Ausgabe von git */
    commit: (
      projectId: string,
      targetId: string,
      message: string,
      paths?: string[]
    ) => Promise<string>
    /** Branch des Worktrees in den aktuellen Branch des Hauptordners zusammenführen */
    merge: (projectId: string, targetId: string) => Promise<string>
    removeWorktree: (projectId: string, targetId: string, force?: boolean) => Promise<void>
  }
  runs: {
    list: (projectId: string) => Promise<RunInfo[]>
    start: (projectId: string, name: string) => Promise<void>
    stop: (projectId: string, name: string) => Promise<void>
    output: (projectId: string, name: string) => Promise<string>
    onChanged: (cb: (projectId: string) => void) => Unsubscribe
    onOutput: (cb: (projectId: string, name: string, chunk: string) => void) => Unsubscribe
  }
  /** Web-Vorschau des Projekts in einem eigenen Fenster */
  preview: {
    open: (projectId: string) => Promise<void>
    /** Bild der Vorschau als Anhang in den Prompt des Agents eintragen; liefert den Dateipfad */
    screenshot: (projectId: string, agentId: string) => Promise<string>
  }
  prompts: {
    list: () => Promise<PromptTemplate[]>
    save: (input: PromptTemplateInput) => Promise<PromptTemplate>
    remove: (id: string) => Promise<void>
  }
  engines: {
    list: () => Promise<Engine[]>
    save: (input: EngineInput) => Promise<Engine>
    remove: (id: string) => Promise<void>
  }
  reports: {
    /** Zusammenfassung des heutigen Tages (Markdown); projectId leer = alle Projekte */
    daily: (projectId?: string) => Promise<string>
  }
  remote: {
    info: () => Promise<RemoteInfo>
  }
  clipboard: {
    writeText: (text: string) => Promise<void>
    /** Clipboard content for pasting into the terminal: text and whether it holds an image */
    read: () => Promise<{ text: string; hasImage: boolean }>
  }
  /** Ctrl+G in the agent → editor tab in the center instead of an external editor */
  editor: {
    /** Initial text of an open editor tab (null = none open) */
    text: (agentId: string) => Promise<string | null>
    /** Close tab: text = new prompt (null = unchanged), submit = send afterwards */
    finish: (agentId: string, text: string | null, submit: boolean) => Promise<void>
    /** Save an image (e.g. from the clipboard) → file path */
    saveImage: (agentId: string, ext: string, data: ArrayBuffer) => Promise<string>
    pickFiles: () => Promise<string[]>
    /** data: URL for the preview, or null (not an image / too large) */
    imagePreview: (path: string) => Promise<string | null>
    /** Path of a file dropped via drag & drop */
    pathForFile: (file: File) => string
    onOpened: (cb: (agentId: string, text: string) => void) => Unsubscribe
    onAppend: (cb: (agentId: string, text: string) => void) => Unsubscribe
  }
  voice: {
    status: () => Promise<VoiceStatus>
    download: (model: WhisperModelId) => Promise<void>
    deleteModel: (model: WhisperModelId) => Promise<void>
    onProgress: (cb: (p: DownloadProgress) => void) => Unsubscribe
    transcribe: (wav: ArrayBuffer) => Promise<TranscribeResult>
    command: (text: string) => Promise<VoiceCommandResult>
    onGlobalHotkey: (cb: () => void) => Unsubscribe
    /** Text vorlesen (Kurzfassung eines fertigen Agents) */
    onSpeak: (cb: (text: string) => void) => Unsubscribe
  }
  settings: {
    get: () => Promise<Settings>
    /** Throws if the global shortcut is invalid or taken by another application */
    update: (patch: Partial<Settings>) => Promise<Settings>
    /** Temporarily release the global shortcut (while a new shortcut is being recorded) */
    suspendGlobalHotkey: (suspend: boolean) => Promise<void>
  }
  teams: {
    /** Running teams */
    list: () => Promise<Team[]>
    /** Start a team from a team template for a project (task goes to the first member) */
    start: (projectId: string, teamTemplateId: string, task?: string) => Promise<Team>
    /** Stops all agents of the team */
    stop: (teamId: string) => Promise<void>
  }
  teamTemplates: {
    list: () => Promise<TeamTemplate[]>
    save: (input: TeamTemplateInput) => Promise<TeamTemplate>
    remove: (id: string) => Promise<void>
  }
  templates: {
    list: () => Promise<AgentTemplate[]>
    /** Throws on empty/duplicate name or invalid model */
    save: (input: AgentTemplateInput) => Promise<AgentTemplate>
    remove: (id: string) => Promise<void>
  }
  view: {
    /** Last view shown (may contain agents that have already ended) */
    get: () => Promise<Selection>
    set: (selection: Selection) => Promise<void>
  }
}
