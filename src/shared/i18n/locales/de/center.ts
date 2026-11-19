import type en from '../en/center'

/** German texts: namespace `center` */
const de: typeof en = {
  // Single view header
  worktreeTooltip: 'Eigener Worktree: {path}',
  contextTooltip: 'Tokens im Kontext der Unterhaltung (bei der letzten Antwort)',
  contextSize: 'Kontext {tokens}',
  editPromptTooltip: 'Anweisung in einem Tab schreiben – mit Bildern und Diktat ({hotkey})',

  // Grid
  agentCount_one: '{count} Agent',
  agentCount_other: '{count} Agents',
  projectCount_one: '{count} Projekt',
  projectCount_other: '{count} Projekte',
  gridHint: 'Strg+Klick links ändert die Auswahl',
  voiceToActive: 'Sprach-Anweisung an den aktiven Agent ({hotkey})',
  cellHeaderTooltip: 'Doppelklick: Einzelansicht',
  waitingForInput: 'Wartet auf Eingabe',

  // Project view
  startNewAgent: 'Neuen Agent starten',
  noAgents: 'Keine Agents in diesem Projekt.',
  startAgent: 'Agent starten',

  // Nothing selected
  terminal: 'Terminal',
  emptySelect: 'Projekt oder Agent links auswählen.',
  emptyProjectHint: 'Projekt anklicken zeigt alle Agents im Raster.',
  emptyGridHint: 'Strg+Klick auf Agents/Projekte stellt ein eigenes Raster zusammen.',

  // Agent locked while its editor tab is open
  lockedTooltip: '{name} ist gesperrt – Klick wechselt zum Editor-Tab',
  lockedNotice: 'Eingabe gesperrt – die Anweisung wird im Tab geschrieben',
  toTab: 'Zum Tab',
  lockedBadge: 'im Tab',
  lockedBadgeTooltip: 'Gesperrt, bis der Editor-Tab geschlossen wird – Klick wechselt dorthin',

  // Agent buttons
  watchTooltip: 'Teammitglied – nur beobachten. Anweisungen gehen an den Orchestrator.',
  watchTooltipNamed: 'Teammitglied – nur beobachten. Anweisungen gehen an {name}.',
  watching: 'beobachten',
  voiceToAgent: 'Sprach-Anweisung an {name}',
  clearConversation: 'Unterhaltung von {name} leeren (/clear)',
  stopTeamTooltip: 'Team beenden (Orchestrator und alle Mitglieder)',
  stopAgentTooltip: 'Agent beenden'
}

export default de
