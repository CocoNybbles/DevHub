import type en from '../en/project'

/** German texts: namespace `project` */
const de: typeof en = {
  // ProjectDialog
  editTitle: 'Projekt bearbeiten',
  addTitle: 'Projekt hinzufügen',
  optionalTag: '(optional)',
  requiredTag: '(Pflicht)',
  namePlaceholder: 'z. B. MeinProjekt',
  agentFolderLabel: '1 · Agent-Ordner',
  agentFolderHint: 'Hier werden Claude und andere KI-Coding-Agents gestartet.',
  agentFolderPlaceholder: 'C:\\Dev\\MeinProjekt',
  projectFileLabel: '2 · Projektdatei',
  projectFileFoundHint: 'Automatisch im Agent-Ordner gefunden.',
  projectFileHint: '.sln oder Projektdatei, z. B. zum Öffnen in Visual Studio oder Rider.',
  openWithLabel: 'Öffnen mit',
  projectFileAppHintSettings:
    'Programm für die Projektdatei, z. B. Rider oder eine bestimmte Visual-Studio-Version. Leer = Programm aus den Einstellungen.',
  projectFileAppHintDefault:
    'Programm für die Projektdatei, z. B. Rider oder eine bestimmte Visual-Studio-Version. Leer = Windows-Standardprogramm.',
  windowsDefaultProgram: 'Windows-Standardprogramm',
  folderLabel: '3 · Ordner',
  folderHint: 'Ordner, der in einem Editor geöffnet wird, z. B. VS Code.',
  useAgentFolderTooltip: 'Agent-Ordner übernehmen',
  useAgentFolder: '= Pfad 1',
  folderAppHintSettings:
    'Programm für den Ordner, z. B. Cursor oder ein anderer Editor. Leer = Programm aus den Einstellungen.',
  folderAppHintDefault:
    'Programm für den Ordner, z. B. Cursor oder ein anderer Editor. Leer = {program}.',
  windowsExplorer: 'Windows-Explorer',
  startFlagsLabel: 'Start-Flags',
  startFlagsPlaceholder: 'z. B. --permission-mode plan',
  useWorktrees: 'Jeder Agent arbeitet in einem eigenen Git-Worktree (eigener Branch)',
  useWorktreesHint:
    'Mehrere Agents stören sich so nicht gegenseitig; ihre Änderungen prüfst und führst du über „Änderungen prüfen“ zusammen. Braucht ein Git-Repository mit mindestens einem Commit. Nicht versionierte Dateien (z. B. node_modules, .env) fehlen im Worktree.',
  checksLabel: 'Prüfungen bei „Fertig“',
  checksHint:
    'Ein Befehl je Zeile. Hat ein Agent Dateien geändert und meldet fertig, laufen sie in seinem Arbeitsverzeichnis; schlägt einer fehl, bekommt der Agent die Ausgabe und bessert nach (höchstens dreimal je Anweisung).',
  runCommandsLabel: 'Befehle zum Ausführen',
  runCommandsHint:
    'Je Zeile „Name = Befehl“. Start/Stopp und Ausgabe unter „Ausführen“ (Rechtsklick aufs Projekt); Agents können die Ausgabe lesen.',
  previewLabel: 'Web-Vorschau',
  permissionRulesLabel: 'Freigabe-Regeln',
  permissionRulesHint:
    'Eine Regel je Zeile: Tool-Name (z. B. Edit) oder „Bash:Befehlsanfang“. Passende Aufrufe werden für Agents dieses Projekts ohne Nachfrage erlaubt; verkettete Befehle (&&, |, ; …) passen nie. „Immer“ im Eingang trägt hier Regeln ein.',

  // ImportProjectsDialog
  importTitle: 'Projekte importieren',
  importNoneFound: 'In den gewählten Ordnern wurden keine Projekte gefunden.',
  importNotAdded: 'Nicht hinzugefügt:\n{list}',
  importAdd_one: '1 Projekt hinzufügen',
  importAdd_other: '{count} Projekte hinzufügen',
  importPickFolders: 'Ordner auswählen …',
  importPickMoreFolders: 'Weitere Ordner auswählen …',
  importPickHint:
    'Ein Ordner mit mehreren Projekten (z. B. „C:\\Dev“) oder einzelne Projektordner – mit Strg+Klick mehrere. Gesucht wird nach Git, .sln, .csproj, package.json, pyproject.toml u. a., auch in Unterordnern; die Projektdatei (.sln) wird automatisch gesucht.',
  importScanning: 'Durchsuche Ordner …',
  importFoundInFolder: '{count} gefunden in {folder}',
  importFoundInFolders: '{count} gefunden in {folders} Ordnern',
  importNameTooltip: 'Name des Projekts',
  importAlreadyRegistered: 'bereits registriert',
  importProjectFile: 'Projektdatei: {file}',
  importNoProjectFile: 'keine Projektdatei gefunden',
  importStartFlagsLabel: 'Start-Flags für alle'
}

export default de
