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
    /** templateId: start from a template (name, model, instructions) */
    start: (projectId: string, task?: string, templateId?: string) => Promise<Agent>
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
