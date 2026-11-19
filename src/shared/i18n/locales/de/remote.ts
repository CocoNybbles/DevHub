import type en from '../en/remote'

/** German texts: namespace `remote` */
const de: typeof en = {
  portInUse: 'Port {port} ist bereits belegt',
  textMissing: 'Text fehlt',
  invalidAnswer: 'Ungültige Antwort',
  permissionTitle: 'Freigabe: {agent} → {tool}',
  alwaysRule: 'Immer ({rule})',
  instructionPlaceholder: 'Anweisung an {name}',
  send: 'Senden',
  noAgents: 'Keine Agents laufen.',
  noConnection: 'keine Verbindung',
  summary_one: '{count} Agents',
  summary_other: '{count} Agents',
  summaryWaiting_one: '{count} Agents · {waiting} warten',
  summaryWaiting_other: '{count} Agents · {waiting} warten'
}

export default de
