import type en from '../en/run'

/** German texts: namespace `run` */
const de: typeof en = {
  title: 'Ausführen · {project}',
  noPreviewUrl: 'Keine Vorschau-Adresse eingetragen (Projekt bearbeiten)',
  openPreview: 'Vorschau öffnen',
  screenshotTooltip:
    'Bild der Vorschau als Anhang in den Prompt von {name} eintragen (noch nicht abgeschickt)',
  screenshotNoAgentTooltip: 'Dafür muss ein Agent dieses Projekts ausgewählt sein',
  screenshotDone: 'Screenshot steht im Prompt von {name}.',
  screenshotTo: 'Screenshot an {name}',
  setup: 'Befehle und Vorschau einrichten …',
  empty:
    'Für dieses Projekt sind noch keine Befehle eingerichtet (z. B. „dev = npm run dev“, „test = npm test“). Sie laufen im Agent-Ordner; Agents können ihre Ausgabe lesen.',
  stateRunning: 'läuft',
  stateNotStarted: 'nicht gestartet',
  stateExited: 'beendet ({code})',
  stop: 'Stopp',
  start: 'Start'
}

export default de
