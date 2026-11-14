import type en from '../en/main'

/** German texts: namespace `main` */
const de: typeof en = {
  // dataPath.ts
  dataDirNotWritable:
    'DevHub speichert seine Daten neben der Programmdatei, hat aber keine Schreibrechte für:\n{dir}\n\nBitte DevHub in einen beschreibbaren Ordner verschieben (z. B. nicht unter „Programme“).',

  // claudeAuth.ts
  authExpired: 'Die Anmeldung ist abgelaufen.',
  authStatusUnreadable: 'Antwort von `claude auth status` konnte nicht gelesen werden.',

  // tools.ts
  invalidPath: 'Ungültiger Pfad',
  pathNotFound: 'Pfad nicht gefunden: {path}',
  programFullPath: 'Programm: bitte den vollständigen Pfad angeben',
  programExtension: 'Programm: muss eine .exe (oder .cmd/.bat) sein',
  programNotFound: 'Programm nicht gefunden: {path}',
  programStartFailed: 'Programm konnte nicht gestartet werden: {error}',

  // index.ts – generic
  quoted: '„{name}“',
  projectNotFound: 'Projekt nicht gefunden',
  nameMissing: 'Name fehlt',
  nameEndsWithNumber: 'Name darf nicht auf eine Zahl enden',
  agentNameReserved: '„Agent N“ ist für normale Agents reserviert',

  // index.ts – review (Git)
  reviewMainFolder: 'Hauptordner',
  reviewMainFolderBranch: 'Hauptordner ({branch})',
  reviewEndedAgent: '{name} (beendet)',
  workdirNotFound: 'Arbeitsverzeichnis nicht gefunden',
  mergeOnlyWorktrees: 'Nur Worktrees lassen sich zusammenführen',
  mainFolderNotRemovable: 'Der Hauptordner kann nicht entfernt werden',
  worktreeAgentRunning: 'In diesem Worktree läuft noch ein Agent – erst beenden',

  // index.ts – web preview
  previewUrlMissing: 'Für „{name}“ ist keine Vorschau-Adresse eingetragen (Projekt bearbeiten)',
  previewTitle: 'Vorschau · {name}',

  // index.ts – projects
  agentPathMissing: 'Agent-Pfad existiert nicht',
  projectFileMissing: 'Projektdatei existiert nicht',
  folderPathMissing: 'Ordner (Pfad 3) existiert nicht',
  startFlagsError: 'Start-Flags: {error}',
  commandsIncomplete: 'Befehle: Name und Befehl müssen beide ausgefüllt sein',
  commandOneLineNamed: 'Befehl „{name}“: nur eine Zeile',
  commandNamesNotUnique: 'Befehle: Namen müssen eindeutig sein',
  permissionRuleError: 'Freigabe-Regel „{rule}“: {error}',
  previewUrlInvalid: 'Vorschau-Adresse muss mit http:// oder https:// beginnen',
  worktreesNoRepo: 'Worktrees: Der Agent-Ordner liegt in keinem Git-Repository (oder git fehlt)',
  projectFileNotFound: 'Projektdatei nicht gefunden: {path}',
  folderNotFound: 'Ordner nicht gefunden: {path}',
  filterPrograms: 'Programme',
  filterAllFiles: 'Alle Dateien',
  filterSolutions: 'Projektmappen & Projekte',
  filterImages: 'Bilder',
  pickFoldersTitle: 'Ordner mit Projekten auswählen (Strg+Klick für mehrere)',
  pickFilesTitle: 'Bilder oder Dateien anhängen',

  // index.ts – predefined agents and teams
  templateNameEndsWithNumber:
    'Name darf nicht auf eine Zahl enden (wird für „Name 2“, „Name 3“ verwendet)',
  templateExists: 'Es gibt bereits eine Vorlage „{name}“',
  invalidModelName: 'Ungültiger Modellname: {model}',
  templateUsedInTeams: 'Wird in Team {teams} verwendet',
  teamNameReserved: '„Team N“ ist für temporäre Teams reserviert',
  teamNameEndsWithNumber: 'Name darf nicht auf eine Zahl enden (wird für „Name 2“ verwendet)',
  teamExists: 'Es gibt bereits ein Team „{name}“',
  teamTooFewMembers: 'Ein Team braucht mindestens zwei Mitglieder',
  teamTooManyMembers: 'Höchstens 8 Mitglieder',

  // index.ts – inbox, tasks
  invalidAnswer: 'Ungültige Antwort',
  invalidStatus: 'Ungültiger Status',

  // index.ts – prompt library, engines
  textMissing: 'Text fehlt',
  promptExists: 'Es gibt bereits einen Prompt „{name}“',
  commandMissing: 'Befehl fehlt',
  commandOneLine: 'Befehl: nur eine Zeile',
  engineNameTaken: 'Der Name „{name}“ ist schon vergeben (Engine oder vordefinierter Agent)',
  engineInUse: 'Mit dieser Engine läuft noch ein Agent',

  // index.ts – code view
  fileTooLarge: 'Datei ist zu groß (> 5 MB)',

  // index.ts – notification after a global voice command
  voiceAgentStarted: '{agent} gestartet ({project})',
  voiceTeamStarted: 'Team {team} gestartet ({project}): {agents}',

  // index.ts – settings
  hotkeyMissing: 'Kürzel fehlt',
  hotkeyDuplicate: 'Dieses Kürzel ist schon für eine andere Aktion vergeben',
  hotkeyUnavailable: 'Das Kürzel {hotkey} ist ungültig oder von einer anderen Anwendung belegt',
  numberOutOfRange: '{label}: Wert zwischen {min} und {max} erwartet',
  labelContextWarning: 'Kontext-Warnung',
  labelPriceInput: 'Preis Eingabe',
  labelPriceOutput: 'Preis Ausgabe',
  labelPort: 'Port'
}

export default de
