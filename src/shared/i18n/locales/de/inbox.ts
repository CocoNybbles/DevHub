import type en from '../en/inbox'

/** German texts: namespace `inbox` */
const de: typeof en = {
  title: 'Eingang',
  // {agent} and {tool} are rendered in bold
  permissionRequest: '{agent} möchte {tool} ausführen',
  denyPlaceholder: 'Begründung / was stattdessen (optional)',
  alwaysTooltip:
    'Regel „{rule}“ für dieses Projekt speichern: solche Aufrufe werden künftig ohne Nachfrage erlaubt (Projekt bearbeiten → Freigabe-Regeln)',
  inTerminal: 'im Terminal',
  inTerminalTooltip: 'Den normalen Dialog im Terminal des Agents zeigen',
  showAgent: 'Agent zeigen',
  clickShowAgent: 'Klick: Agent zeigen',
  waitingForInput: 'Wartet auf Eingabe',
  replyPlaceholder: 'Nächste Anweisung an {name}',
  // {agents} (list of names) is rendered in bold
  conflict: '{agents} bearbeiten dieselbe Datei',
  dismiss: 'Ausblenden'
}

export default de
