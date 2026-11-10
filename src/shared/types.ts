/** Typen, die von Main-, Preload- und Renderer-Prozess gemeinsam genutzt werden. */

export type ClaudeAuthState =
  | { kind: 'notInstalled' }
  | { kind: 'loggedOut'; reason?: string }
  | { kind: 'loggedIn'; authMethod?: string; loginExpiresAt?: string; subscriptionType?: string }
  | { kind: 'error'; message: string }

export interface Project {
  id: string
  name: string
  /** Pfad 1: Arbeitsverzeichnis, in dem Agents gestartet werden */
  agentPath: string
  /** Pfad 2: .sln / Projektdatei (z. B. für Visual Studio) */
  projectFile?: string
  /** Pfad 3: Ordner für VS Code (nur wenn VS Code installiert ist) */
  vscodePath?: string
  /** Zusätzliche Start-Flags für Agents dieses Projekts (ergänzen/überschreiben die globalen) */
  agentArgs?: string
}

export type ProjectInput = Omit<Project, 'id'> & { id?: string }

/**
 * starting   – Prozess gestartet, noch keine Rückmeldung
 * working    – Agent arbeitet
 * idle       – bereit, noch keine Aufgabe
 * needsInput – wartet auf Antwort/Freigabe/nächste Anweisung → links hervorgehoben
 */
export type AgentStatus = 'starting' | 'working' | 'idle' | 'needsInput'

export interface Agent {
  id: string
  projectId: string
  name: string
  /** Claude-Session-ID (für --session-id / --resume) */
  sessionId: string
  status: AgentStatus
  statusMessage?: string
  createdAt: number
  /** Sprachtext automatisch abschicken: überschreibt `Settings.voiceAutoSend`, undefined = global */
  voiceAutoSend?: boolean
  /** Beim Start festgelegtes Modell (`--model`, z. B. per Sprachbefehl), hat Vorrang vor den Start-Flags */
  model?: string
}

/** Von einem Agent über das MCP-Tool `show_code` gemeldete Code-Stelle. */
export interface CodeFocus {
  agentId: string
  filePath: string
  startLine: number
  endLine: number
  note?: string
  at: number
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
  /** whisper.cpp-Programm vorhanden */
  engineInstalled: boolean
  models: WhisperModelInfo[]
  /** Aktives, installiertes Modell – null = Sprachsteuerung noch nicht einsatzbereit */
  activeModel: WhisperModelId | null
}

export interface DownloadProgress {
  phase: 'engine' | 'model' | 'done' | 'error'
  receivedBytes: number
  totalBytes: number
  message?: string
}

export type VoiceCommandResult =
  /** sent = false: nur ins Terminal eingetragen (Auto-Abschicken aus) */
  | { kind: 'sent'; agentName: string; message: string; sent: boolean }
  | { kind: 'started'; agentName: string; projectName: string; task?: string; model?: string }
  | { kind: 'none'; message: string }

export interface Settings {
  voiceModel: WhisperModelId | null
  /** Transkribierten Text direkt mit Enter abschicken */
  voiceAutoSend: boolean
  /** Kürzel (Electron-Accelerator, siehe shared/hotkeys.ts): Aufnahme für den aktiven Agent, nur in der App */
  hotkeyAgentVoice: string
  /** Kürzel: globaler Sprachbefehl, systemweit per globalShortcut */
  hotkeyGlobalVoice: string
  /** Zusätzliche Start-Flags für alle Agents, z. B. `--permission-mode auto` (siehe shared/agentArgs.ts) */
  agentArgs: string
  /** Zuletzt erkannte Sprache merken und bei der nächsten Aufnahme zuerst vorgeben (schneller) */
  voiceRememberLanguage: boolean
  /** Gemerkte Sprache (whisper-Code, z. B. „de“), null = noch keine */
  voiceLanguage: string | null
}

export interface TranscribeResult {
  text: string
  /** Erkannte bzw. verwendete Sprache (whisper-Code) */
  language: string
  /** true = gemerkte Sprache wurde übernommen (ohne automatische Erkennung) */
  remembered: boolean
}

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
    openProjectFile: (id: string) => Promise<void>
    openInVSCode: (id: string) => Promise<void>
    pickFolder: (defaultPath?: string) => Promise<string | null>
    pickProjectFile: (defaultPath?: string) => Promise<string | null>
    /** Sucht im Ordner (bis 3 Ebenen tief) nach einer .sln/.slnx; null, wenn keine. */
    findSolution: (dir: string) => Promise<string | null>
  }
  agents: {
    list: () => Promise<Agent[]>
    /** Stellt beim App-Start die Agents der letzten Sitzung wieder her. */
    restore: () => Promise<void>
    start: (projectId: string, task?: string) => Promise<Agent>
    stop: (id: string) => Promise<void>
    rename: (id: string, name: string) => Promise<void>
    write: (id: string, data: string) => void
    /** Text als Anweisung senden (Text + Enter). */
    sendLine: (id: string, text: string) => Promise<void>
    /** Sprachtext je nach Einstellung (Agent, sonst global) abschicken oder nur eintragen; true = abgeschickt */
    sendVoice: (id: string, text: string) => Promise<boolean>
    /** undefined = globale Einstellung verwenden */
    setVoiceAutoSend: (id: string, value: boolean | undefined) => Promise<void>
    resize: (id: string, cols: number, rows: number) => void
    /** Bisherige Terminal-Ausgabe (z. B. nach Neuladen der Oberfläche). */
    buffer: (id: string) => Promise<string>
    onData: (cb: (id: string, data: string) => void) => Unsubscribe
    onChanged: (cb: (agents: Agent[]) => void) => Unsubscribe
    /** Agent hat sich direkt nach dem Start mit Fehler beendet (z. B. ungültiges Start-Flag) */
    onStartFailed: (cb: (agentName: string, output: string) => void) => Unsubscribe
  }
  code: {
    readFile: (path: string) => Promise<FileReadResult>
    openInVSCode: (path: string, line: number) => Promise<void>
    onFocus: (cb: (focus: CodeFocus) => void) => Unsubscribe
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
    /** Wirft, wenn das globale Kürzel ungültig oder von einer anderen Anwendung belegt ist */
    update: (patch: Partial<Settings>) => Promise<Settings>
    /** Globales Kürzel vorübergehend freigeben (während ein neues Kürzel aufgenommen wird) */
    suspendGlobalHotkey: (suspend: boolean) => Promise<void>
  }
}
