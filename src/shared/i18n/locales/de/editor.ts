import type en from '../en/editor'

/** German texts: namespace `editor` */
const de: typeof en = {
  title: 'Anweisung für {name}',
  terminalLocked: 'Terminal gesperrt',
  terminalLockedTooltip: 'Der Agent wartet, bis dieser Tab geschlossen wird',
  closeTooltip: 'Tab schließen – Text in den Prompt übernehmen, ohne abzuschicken',
  placeholder:
    'Anweisung eingeben oder diktieren …\n\nBilder: Strg+V, hierher ziehen oder 📎 – sie werden als @"pfad" angehängt.\nStrg+Enter schickt ab.',
  placeholderOpening: 'Editor wird geöffnet …',
  attach: 'Anhängen',
  attachTooltip: 'Bilder oder Dateien anhängen',
  discardTooltip: 'Änderungen verwerfen – der Prompt bleibt wie vor Strg+G',
  applyToPrompt: 'In Prompt übernehmen',
  applyTooltip: 'Text in den Prompt des Agents übernehmen, ohne abzuschicken',
  sendTooltip: 'Übernehmen und abschicken (Strg+Enter)'
}

export default de
