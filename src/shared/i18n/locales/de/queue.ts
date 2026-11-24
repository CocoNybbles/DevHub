import type en from '../en/queue'

/** German texts: namespace `queue` */
const de: typeof en = {
  title: 'Auftrag für {name}',
  enqueue: 'In die Warteschlange',
  fromLibrary: 'Aus der Prompt-Bibliothek',
  freeText: '– frei schreiben –',
  instructionLabel: 'Anweisung',
  instructionPlaceholder: 'Was soll der Agent als Nächstes tun?',
  hintBusy: '{name} arbeitet gerade – der Auftrag wird abgeschickt, sobald er fertig meldet.',
  hintFree: 'Der Auftrag geht sofort an den Agent, wenn nichts davor wartet.',
  queuedHeading: 'Wartet bereits',
  remove: 'entfernen'
}

export default de
