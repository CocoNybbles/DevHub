import type en from '../en/sidebar'

/** German texts: namespace `sidebar` */
const de: typeof en = {
  // Agent status (tooltip of an agent row)
  statusStarting: 'Startet …',
  statusWorking: 'Arbeitet',
  statusIdle: 'Bereit',
  statusNeedsInput: 'Wartet auf Eingabe',

  // Start menu
  startAgent: 'Agent starten',
  startNamed: '{name} starten',
  startNamedWithModel: '{name} starten ({model})',
  startTeam: 'Team {name} starten ({members})',
  moreEngines: 'Weitere Engines',
  startChoiceTooltip: 'Starten: Agent, vordefinierter Agent oder Team',
  startNewAgent: 'Neuen Agent starten',

  // Agent row
  workerHint:
    'Teammitglied – nur beobachten; Anweisungen gehen an den Orchestrator\nStrg+Klick: zum Raster hinzufügen/entfernen\nZiehen: Reihenfolge ändern',
  agentHint:
    'Strg+Klick: zum Raster hinzufügen/entfernen\nZiehen: Reihenfolge ändern\nRechtsklick: umbenennen, Sprach-Einstellung',
  tooltipWorktree: 'Worktree: {branch}',
  tooltipQueue_one: '{count} Auftrag in der Warteschlange',
  tooltipQueue_other: '{count} Aufträge in der Warteschlange',
  tooltipModel: 'Modell: {model}',
  tooltipOrchestrator: 'Orchestrator: steuert das Team, einziger Ansprechpartner',
  tooltipLead: 'Leitet das Team',
  leadTag: 'Leitung',
  watchOnly: 'Nur beobachten',
  editingTag: 'Tab',
  editingTagTooltip: 'Anweisung wird im Editor-Tab geschrieben – Klick wechselt dorthin',
  worktreeTag: 'wt',
  worktreeTagTooltip: 'Eigener Worktree: {branch}',
  queueTagTooltip: 'Aufträge in der Warteschlange',
  toEditorTab: 'Zum Editor-Tab',
  editPromptTooltip: 'Anweisung in einem Tab schreiben – mit Bildern und Diktat ({hotkey})',
  voiceToAgent: 'Sprach-Anweisung an {name}',
  clearConversation: 'Unterhaltung von {name} leeren (/clear)',
  stopTeamTooltip: 'Team beenden (Orchestrator und alle Mitglieder)',
  stopAgentTooltip: 'Agent beenden',

  // Agent context menu
  menuWriteInTab: 'Anweisung im Tab schreiben ({hotkey})',
  menuQueueMore: 'Auftrag anhängen … ({count} warten)',
  menuQueue: 'Auftrag / Prompt aus der Bibliothek …',
  menuReview: 'Änderungen prüfen …',
  menuFork: 'Unterhaltung abzweigen',
  menuStopTeam: 'Team beenden',
  menuStop: 'Beenden',
  menuVoiceHeading: 'Sprach-Anweisungen',
  menuVoiceGlobalSend: 'Wie global (abschicken)',
  menuVoiceGlobalInsert: 'Wie global (nur eintragen)',
  menuVoiceAutoSend: 'Automatisch abschicken',
  menuVoiceInsertOnly: 'Nur ins Terminal eintragen',

  // Team
  menuShowInGrid: 'Im Raster zeigen',
  menuSortMembers: 'Mitglieder nach Name sortieren',
  teamTitle: 'Team „{name}“',
  teamTitleTemporary: 'Temporäres Team „{name}“',
  teamOrchestratorLine:
    'Orchestrator: {name} – steuert die Mitglieder, nur mit ihm sprichst du; die Mitglieder kannst du beobachten',
  teamLeadLine: 'Leitung: {name}',
  teamClickHint: 'Klick: alle im Raster · Strg+Klick: hinzufügen/entfernen · Rechtsklick: beenden',
  temporaryTag: 'temporär',
  agentWaiting: 'Ein Agent wartet',

  // Header
  globalVoiceTooltip: 'Sprachbefehl: Agent/Team per Name ansprechen oder neu starten ({hotkey})',
  sortProjects: 'Projekte alphanumerisch aufsteigend sortieren',
  addProject: 'Projekt hinzufügen',
  importProjects:
    'Projekte importieren: Ordner durchsuchen (z. B. ganzer Dev-Ordner, mehrere per Strg+Klick)',
  noProjects: 'Noch keine Projekte registriert.',

  // Project row
  menuTasks: 'Aufgaben …',
  menuRun: 'Ausführen / Vorschau …',
  menuSortAgents: 'Agents nach Name sortieren',
  menuEdit: 'Bearbeiten …',
  projectHint:
    'Strg+Klick: alle Agents zum Raster hinzufügen/entfernen\nZiehen: Reihenfolge ändern',
  openProjectFile: 'Projektdatei öffnen: {file}\nmit {program}',
  openFolder: 'Ordner öffnen: {folder}\nmit {program}',
  windowsDefaultProgram: 'Windows-Standardprogramm',
  windowsExplorer: 'Windows-Explorer',

  // Footer
  tasksTooltip: 'Aufgaben-Board: Aufgaben sammeln, Agents damit starten oder ihnen einreihen',
  history: 'Verlauf',
  historyTooltip: 'Beendete Sitzungen fortsetzen, alle Unterhaltungen durchsuchen, Verbrauch',
  report: 'Bericht',
  reportTooltip: 'Tagesbericht: Was haben die Agents heute getan, was ist offen?'
}

export default de
