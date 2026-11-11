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
  /** Strg+G: Anweisung wird gerade im Editor-Tab geschrieben → Agent sonst gesperrt (nicht gespeichert) */
  editing?: boolean
}

/** Mitglied einer Team-Vorlage: vordefinierter Agent oder (ohne templateId) normaler Agent. */
export interface TeamMember {
  templateId?: string
}

/** Fest definiertes Team aus vordefinierten Agents (Einstellungen). */
export interface TeamTemplate {
  id: string
  name: string
  /** Reihenfolge zählt: das erste Mitglied leitet das Team und bekommt die Aufgabe */
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
    /** templateId: aus einer Vorlage starten (Name, Modell, Anweisung) */
    start: (projectId: string, task?: string, templateId?: string) => Promise<Agent>
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
  }
  clipboard: {
    writeText: (text: string) => Promise<void>
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
