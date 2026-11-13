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
  /** Pfad 2: .sln / Projektdatei (z. B. für Visual Studio, Rider …) */
  projectFile?: string
  /** Programm (Pfad zur .exe) für die Projektdatei; leer = globale Einstellung */
  projectFileApp?: string
  /** Pfad 3: Ordner, der in einem Editor geöffnet wird (früher `vscodePath`, wird beim Laden übernommen) */
  folderPath?: string
  /** Programm (Pfad zur .exe) für den Ordner; leer = globale Einstellung */
  folderApp?: string
  /** Zusätzliche Start-Flags für Agents dieses Projekts (ergänzen/überschreiben die globalen) */
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

/** Beim Import gefundener Projektordner */
export interface ScannedProject {
  path: string
  /** Vorschlag: Ordnername */
  name: string
  /** Woran erkannt (z. B. „Git“, „.sln“, „Node“) */
  marker: string
  /** Automatisch gefundene .sln/.slnx (null = keine) */
  projectFile: string | null
  /** Ordner ist schon als Projekt registriert */
  registered: boolean
}

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
  /** Beim Start festgelegtes Modell (`--model`, z. B. per Sprachbefehl), hat Vorrang vor Vorlage und Start-Flags */
  model?: string
  /** Vorlage, aus der der Agent gestartet wurde (Modell + Anweisung werden bei jedem Start gelesen) */
  templateId?: string
  /** Laufendes Team, zu dem der Agent gehört (Mitglieder dürfen sich Nachrichten schicken) */
  teamId?: string
  /**
   * Rolle im Team: `orchestrator` (wird mit jedem Team gestartet, einziger Ansprechpartner des
   * Nutzers) oder `worker` (nur beobachtbar, keine Eingaben). Fehlt bei Teams aus älteren Ständen.
   */
  teamRole?: TeamRole
  /** Strg+G: Anweisung wird gerade im Editor-Tab geschrieben → Agent sonst gesperrt (nicht gespeichert) */
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

/** Teammitglied, das nur beobachtet werden kann (Aufträge kommen ausschließlich vom Orchestrator) */
export const isTeamWorker = (a: Pick<Agent, 'teamRole'>): boolean => a.teamRole === 'worker'

/** Orchestrator eines Teams; ältere Teams ohne Orchestrator: zuerst gestartetes Mitglied (Leitung) */
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

/** Mitglied einer Team-Vorlage: vordefinierter Agent oder (ohne templateId) normaler Agent. */
export interface TeamMember {
  templateId?: string
}

/** Fest definiertes Team aus vordefinierten Agents (Einstellungen). */
export interface TeamTemplate {
  id: string
  name: string
  /** Ausführende Agents; dazu startet immer automatisch ein Orchestrator, der sie steuert */
  members: TeamMember[]
  /** Gemeinsame Richtlinien für alle Mitglieder (z. B. Ablauf, Übergaben) */
  instructions?: string
}

export type TeamTemplateInput = Omit<TeamTemplate, 'id'> & { id?: string }

/** Laufendes Team in einem Projekt (aus einer Team-Vorlage oder temporär per Sprache). */
export interface Team {
  id: string
  name: string
  projectId: string
  /** Team-Vorlage (Richtlinien werden bei jedem Start gelesen); fehlt bei temporären Teams */
  teamTemplateId?: string
  temporary: boolean
  createdAt: number
}

/** Vordefinierter, benannter Agent (z. B. „Entwickler“) – per Sprache oder Liste startbar. */
export interface AgentTemplate {
  id: string
  /** Eindeutig; gestartete Agents heißen so (bei Bedarf „Name 2“, „Name 3“ …) */
  name: string
  /** `--model` (Alias oder voller Name); leer = Start-Flags. Ein per Sprache genanntes Modell hat Vorrang. */
  model?: string
  /** Rolle/Richtlinien, werden an den System-Prompt angehängt */
  instructions?: string
}

export type AgentTemplateInput = Omit<AgentTemplate, 'id'> & { id?: string }

/** Von einem Agent über das MCP-Tool `show_code` gemeldete Code-Stelle. */
export interface CodeFocus {
  agentId: string
  filePath: string
  startLine: number
  endLine: number
  note?: string
  at: number
}

/** Code-Block aus einer Antwort des Agents (aus dem Transkript), rechts mit Kopier-Button. */
export interface CodeSnippet {
  /** `<Nachrichten-uuid>-<n>` */
  id: string
  agentId: string
  /** Sprache aus dem Code-Zaun (```sql), klein geschrieben; '' = keine Angabe */
  language: string
  code: string
  /** Zeitpunkt der Antwort (ms) */
  at: number
}

/** Zeilenbereich (1-basiert, inklusive) */
export interface LineRange {
  start: number
  end: number
}

/** Vom Agent bearbeitete Datei (Edit/Write/MultiEdit), rechts als eigener Reiter. */
export interface EditedFile {
  agentId: string
  filePath: string
  /** Zeitpunkt der letzten Änderung (ms) */
  at: number
  /** Geänderte Zeilen der letzten Änderung (leer = unbekannt bzw. neu angelegt) */
  changedLines: LineRange[]
  /** Letzte Änderung hat die Datei neu angelegt */
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
  | {
      kind: 'started'
      agentName: string
      projectName: string
      task?: string
      model?: string
      /** Name der verwendeten Vorlage */
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
  /** Transkribierten Text direkt mit Enter abschicken */
  voiceAutoSend: boolean
  /** Kürzel (Electron-Accelerator, siehe shared/hotkeys.ts): Aufnahme für den aktiven Agent, nur in der App */
  hotkeyAgentVoice: string
  /** Kürzel: globaler Sprachbefehl, systemweit per globalShortcut */
  hotkeyGlobalVoice: string
  /** Kürzel (in der App): Anweisung für den aktiven Agent im Editor-Tab schreiben */
  hotkeyEditor: string
  /** Zusätzliche Start-Flags für alle Agents, z. B. `--permission-mode auto` (siehe shared/agentArgs.ts) */
  agentArgs: string
  /** Programm (Pfad zur .exe) für Projektdateien; leer = Windows-Standardprogramm der Dateiendung */
  projectFileApp: string
  /** Programm (Pfad zur .exe) für Projektordner; leer = VS Code (falls installiert), sonst Explorer */
  folderApp: string
  /** Zuletzt erkannte Sprache merken und bei der nächsten Aufnahme zuerst vorgeben (schneller) */
  voiceRememberLanguage: boolean
  /** Gemerkte Sprache (whisper-Code, z. B. „de“), null = noch keine; Englisch wird nie gemerkt */
  voiceLanguage: string | null
  /** Feste Sprache der Spracheingabe (whisper-Code), null = automatisch erkennen */
  voiceFixedLanguage: string | null
  /** Dateivorschau: vom aktiven Agent bearbeitete Dateien rechts als Reiter zeigen */
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
  /** Erkannte bzw. verwendete Sprache (whisper-Code) */
  language: string
  /** true = gemerkte Sprache wurde übernommen (ohne automatische Erkennung) */
  remembered: boolean
}

/** Ansicht in der Mitte; wird gespeichert und beim App-Start wiederhergestellt. */
export type Selection =
  | { kind: 'agent'; agentId: string }
  | { kind: 'project'; projectId: string; activeAgentId?: string }
  /** Frei zusammengestelltes Raster (Strg+Klick), auch projektübergreifend */
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
    /** Neue Reihenfolge (Ids in Anzeigereihenfolge); liefert die sortierte Liste */
    reorder: (ids: string[]) => Promise<Project[]>
    /** Ordnerauswahl mit Mehrfachauswahl (Strg+Klick) für den Import */
    pickFolders: () => Promise<string[]>
    /** Durchsucht Ordner nach Projekten (inkl. Unterordnern, Projektdatei-Suche) */
    scan: (dirs: string[]) => Promise<ScannedProject[]>
    openProjectFile: (id: string) => Promise<void>
    /** Ordner (Pfad 3) öffnen: Programm Projekt → global → VS Code → Explorer */
    openFolder: (id: string) => Promise<void>
    pickFolder: (defaultPath?: string) => Promise<string | null>
    pickProjectFile: (defaultPath?: string) => Promise<string | null>
    /** Sucht im Ordner (bis 3 Ebenen tief) nach einer .sln/.slnx; null, wenn keine. */
    findSolution: (dir: string) => Promise<string | null>
    /** Dateiauswahl für ein Programm (.exe/.cmd/.bat) */
    pickProgram: (defaultPath?: string) => Promise<string | null>
  }
  agents: {
    list: () => Promise<Agent[]>
    /** Stellt beim App-Start die Agents der letzten Sitzung wieder her. */
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
    /** Neue Reihenfolge einer Gruppe (Agents eines Projekts/Teams); andere bleiben stehen */
    reorder: (ids: string[]) => Promise<void>
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
    /** Agents und laufende Teams haben sich geändert */
    onChanged: (cb: (agents: Agent[], teams: Team[]) => void) => Unsubscribe
    /** Agent hat sich direkt nach dem Start mit Fehler beendet (z. B. ungültiges Start-Flag) */
    onStartFailed: (cb: (agentName: string, output: string) => void) => Unsubscribe
  }
  code: {
    readFile: (path: string) => Promise<FileReadResult>
    openInVSCode: (path: string, line: number) => Promise<void>
    onFocus: (cb: (focus: CodeFocus) => void) => Unsubscribe
    /** Snippets aller laufenden Agents (neueste zuerst), z. B. nach Neuladen der Oberfläche */
    snippets: () => Promise<Record<string, CodeSnippet[]>>
    /** Snippet-Liste eines Agents hat sich geändert (vollständige Liste, neueste zuerst) */
    onSnippets: (cb: (agentId: string, snippets: CodeSnippet[]) => void) => Unsubscribe
    /** Bearbeitete Dateien aller laufenden Agents (Reihenfolge = erste Bearbeitung) */
    edits: () => Promise<Record<string, EditedFile[]>>
    /** Liste der bearbeiteten Dateien eines Agents hat sich geändert (vollständig) */
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
    /** Inhalt der Zwischenablage zum Einfügen ins Terminal: Text und ob ein Bild darin liegt */
    read: () => Promise<{ text: string; hasImage: boolean }>
  }
  /** Strg+G im Agent → Editor-Tab in der Mitte statt externem Editor */
  editor: {
    /** Anfangstext eines offenen Editor-Tabs (null = keiner offen) */
    text: (agentId: string) => Promise<string | null>
    /** Tab schließen: text = neuer Prompt (null = unverändert), submit = danach abschicken */
    finish: (agentId: string, text: string | null, submit: boolean) => Promise<void>
    /** Bild (z. B. aus der Zwischenablage) speichern → Dateipfad */
    saveImage: (agentId: string, ext: string, data: ArrayBuffer) => Promise<string>
    pickFiles: () => Promise<string[]>
    /** data:-URL für die Vorschau oder null (kein Bild / zu groß) */
    imagePreview: (path: string) => Promise<string | null>
    /** Pfad einer per Drag & Drop abgelegten Datei */
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
    /** Wirft, wenn das globale Kürzel ungültig oder von einer anderen Anwendung belegt ist */
    update: (patch: Partial<Settings>) => Promise<Settings>
    /** Globales Kürzel vorübergehend freigeben (während ein neues Kürzel aufgenommen wird) */
    suspendGlobalHotkey: (suspend: boolean) => Promise<void>
  }
  teams: {
    /** Laufende Teams */
    list: () => Promise<Team[]>
    /** Team aus einer Team-Vorlage für ein Projekt starten (Aufgabe geht an das erste Mitglied) */
    start: (projectId: string, teamTemplateId: string, task?: string) => Promise<Team>
    /** Beendet alle Agents des Teams */
    stop: (teamId: string) => Promise<void>
  }
  teamTemplates: {
    list: () => Promise<TeamTemplate[]>
    save: (input: TeamTemplateInput) => Promise<TeamTemplate>
    remove: (id: string) => Promise<void>
  }
  templates: {
    list: () => Promise<AgentTemplate[]>
    /** Wirft bei leerem/doppeltem Namen oder ungültigem Modell */
    save: (input: AgentTemplateInput) => Promise<AgentTemplate>
    remove: (id: string) => Promise<void>
  }
  view: {
    /** Zuletzt gezeigte Ansicht (kann bereits beendete Agents enthalten) */
    get: () => Promise<Selection>
    set: (selection: Selection) => Promise<void>
  }
}
