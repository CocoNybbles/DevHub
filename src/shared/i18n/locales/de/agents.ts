import type en from '../en/agents'

/** German texts: namespace `agents` */
const de: typeof en = {
  // Errors (shown as toasts)
  agentNotRunningAnymore: 'Agent läuft nicht mehr',
  agentNotRunning: 'Agent läuft nicht',
  projectNotFound: 'Projekt nicht gefunden',
  teamTemplateNotFound: 'Team-Vorlage nicht gefunden',
  teamNeedsTwoMembers: 'Ein Team braucht mindestens zwei Mitglieder',
  teamTooLarge: 'Höchstens {max} Agents pro Team',
  memberTemplateDeleted: 'Ein Mitglied verweist auf einen gelöschten vordefinierten Agent',
  invalidModelName: 'Ungültiger Modellname: {model}',
  templateNotFound: 'Vorlage nicht gefunden',
  engineNotFound: 'Engine nicht gefunden',
  engineDeleted: 'Die Engine dieses Agents wurde gelöscht',
  claudeNotFound: 'Claude Code wurde nicht gefunden',
  folderMissing: 'Ordner fehlt: {path}',
  worktreesNeedGit:
    'Für „{project}“ sind Worktrees eingeschaltet, der Agent-Ordner liegt aber in keinem Git-Repository (oder git fehlt).',
  forkOnlyClaude: 'Abzweigen geht nur mit Claude-Code-Agents',
  forkNoTeamMembers: 'Teammitglieder können nicht abgezweigt werden',
  forkNoSession: '{name} hat noch keine gespeicherte Unterhaltung',
  archiveEntryNotFound: 'Eintrag nicht gefunden',
  transcriptGone: 'Das Transkript dieser Sitzung gibt es nicht mehr',
  sessionAlreadyRunning: 'Diese Sitzung läuft bereits',
  workerStopDenied: '{name} gehört zu einem Team – beende das Team oder bitte den Orchestrator',
  workerRenameDenied: 'Teammitglieder können nicht umbenannt werden',
  workerNoOrchestrator: '{name} hat keinen laufenden Orchestrator',
  workerObserveOnly: '{name} kann nur beobachtet werden – Anweisungen gehen an den Orchestrator',
  workerQueueDenied: '{name} bekommt Aufträge nur vom Orchestrator',
  editingInTab: '{name} wird gerade im Editor-Tab bearbeitet',
  queueTextEmpty: 'Auftrag ist leer',
  taskEmpty: 'Aufgabe ist leer',
  taskNotFound: 'Aufgabe nicht gefunden',
  taskOrAgentNotFound: 'Aufgabe oder Agent nicht gefunden',
  permissionNotOpen: 'Diese Freigabe ist nicht mehr offen',

  // Status texts (sidebar, grid header, notifications)
  statusDone: 'Fertig',
  statusDoneWaiting: 'Fertig – wartet auf Eingabe',
  statusAsksQuestion: 'Stellt eine Frage',
  statusNeedsInput: 'Benötigt Eingabe',
  statusEngineQuiet: 'Keine Ausgabe – wartet vermutlich',
  statusChecksRunning: 'Prüfungen laufen …',
  statusCheckFailedFixing: 'Prüfung fehlgeschlagen – korrigiert ({round}/{max})',
  statusDoneChecksGreen: 'Fertig – Prüfungen grün',
  statusDoneCheckFails: 'Fertig – Prüfung „{command}“ schlägt fehl',
  statusDoneCheckStillFails: 'Fertig – Prüfung „{command}“ schlägt weiter fehl',
  statusWaitingForOrchestrator: 'Wartet auf Freigabe durch den Orchestrator',
  statusPermission: 'Freigabe: {action}',

  // Activity log
  activityCheck: 'Prüfung: {command}',
  activityCheckFailed: 'Prüfung fehlgeschlagen: {command}',
  activityAutoAllowed: 'Automatisch erlaubt: {action}',

  // Notices (inbox)
  contextWarning:
    '{name}: Kontext bei {tokens}k Tokens – /compact oder /clear erwägen, bevor automatisch verdichtet wird.'
}

export default de
