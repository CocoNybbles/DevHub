import type en from '../en/code'

/** German texts: namespace `code` */
const de: typeof en = {
  // Tabs
  splitterTooltip: 'Breite ziehen · Doppelklick = Standardbreite',
  closeFileTab: 'Reiter schließen (erscheint bei der nächsten Änderung wieder)',
  closePlanTab: 'Reiter schließen (erscheint wieder, wenn der Agent ihn aktualisiert)',
  closeSnippetsTab: 'Reiter schließen (erscheint beim nächsten Snippet wieder)',
  planTooltip: 'Vom Agent gezeigt: {title}',
  activity: 'Aktivität',
  activityTooltip: 'Letzte Schritte von {name}',
  activityEmpty: 'Noch keine Schritte in dieser Sitzung.',
  snippets: 'Snippets',
  snippetsTooltip: 'Code-Blöcke aus den Antworten des Agents',
  openInVSCode: 'In VS Code öffnen',

  // File tab
  shownByAgent: 'Vom Agent gezeigt',
  createdByAgent: 'Vom Agent angelegt',
  editedByAgent: 'Vom Agent bearbeitet',
  lines: 'Z. {lines}',
  createdAt: 'angelegt um {time}',
  editedAt: 'bearbeitet um {time}',

  // Snippets
  plainText: 'Text',
  lineCount_one: '{count} Zeile',
  lineCount_other: '{count} Zeilen',
  copyTooltip: 'In die Zwischenablage kopieren'
}

export default de
