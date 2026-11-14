import type en from '../en/voiceUi'

/** German texts: namespace `voiceUi` */
const de: typeof en = {
  // Model selection
  confirmDeleteModel: 'Modell wirklich löschen?',
  modelActive: 'aktiv',
  modelInstalled: 'installiert',
  modelDelete: 'löschen',
  loadingEngine: 'Lade Spracherkennung …',
  loadingModel: 'Lade Sprachmodell …',
  activeButton: 'Aktiv',
  useModel: 'Dieses Modell verwenden',
  downloading: 'Lädt …',
  download: 'Herunterladen (~{size} MB)',

  // Setup dialog
  setupTitle: 'Sprachsteuerung einrichten',
  setupLater: 'Später',
  setupIntro:
    'Für die Sprachsteuerung muss zuerst ein Sprachmodell heruntergeladen werden. Die Erkennung läuft danach komplett lokal und offline, Deutsch und Englisch werden automatisch erkannt.',
  setupHintBefore: 'Wähle ein Modell. Das Modell lässt sich später unter ',
  setupHintAfter: ' wechseln oder löschen.',

  // Dictation
  dictationNotSetUp: 'Spracheingabe ist noch nicht eingerichtet (Einstellungen → Sprachmodell).',
  dictationRecording: 'Aufnahme läuft … zum Beenden erneut auf das Mikrofon klicken.',
  dictationMicUnavailable: 'Mikrofon nicht verfügbar: {error}',
  dictationProcessing: 'Wandle in Text um …',
  dictationTooShort: 'Aufnahme zu kurz.',
  dictationNothing: 'Nichts verstanden.'
}

export default de
