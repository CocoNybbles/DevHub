import type en from '../en/review'

/** German texts: namespace `review` */
const de: typeof en = {
  title: 'Änderungen prüfen · {project}',
  kindModified: 'geändert',
  kindAdded: 'hinzugefügt',
  kindDeleted: 'gelöscht',
  kindUntracked: 'neu (noch nicht in Git)',
  confirmDiscardUnsaved: 'Ungespeicherte Änderungen an der Datei verwerfen?',
  commentsSent: 'Kommentare an {name} geschickt.',
  noRepo:
    'Der Agent-Ordner dieses Projekts liegt in keinem Git-Repository – ohne Git gibt es keinen Vergleich.',
  targetTooltip: 'Arbeitsverzeichnis: Hauptordner oder Worktree eines Agents',
  refresh: 'Aktualisieren',
  comparedToFork: 'Vergleich mit der Abzweigung von „{base}“ (inkl. Commits des Agents)',
  comparedToHead: 'Vergleich mit dem letzten Commit',
  mergeTooltip:
    'Branch des Worktrees in den Branch zusammenführen, der im Hauptordner ausgecheckt ist',
  merge: 'Zusammenführen',
  removeWorktreeRunningTooltip: 'Solange der Agent läuft, bleibt sein Worktree bestehen',
  removeWorktreeTooltip: 'Worktree und Branch löschen',
  confirmRemoveWorktree:
    'Worktree „{label}“ samt Branch löschen?\nNicht zusammengeführte Änderungen gehen verloren.',
  removeWorktree: 'Worktree löschen',
  noChanges: 'Keine Änderungen.',
  saveTooltip: 'Rechte Seite in die Datei schreiben',
  discardNewTooltip: 'Neue Datei löschen',
  discardTooltip: 'Datei auf den Vergleichsstand zurücksetzen',
  confirmDiscard: 'Alle Änderungen an „{file}“ verwerfen?',
  discard: 'Verwerfen',
  binary: 'Binärdatei oder zu groß – kein Vergleich.',
  commentPlaceholder:
    'Kommentar zur markierten Stelle (rechts Zeilen markieren, Enter merkt ihn vor)',
  commentPlaceholderNoAgent:
    'Kommentare gehen an den Agent dieses Verzeichnisses – hier läuft keiner',
  addComment: 'Vormerken',
  removeComment: 'entfernen',
  sendComments_one: '{count} Kommentar(e) an {name} schicken',
  sendComments_other: '{count} Kommentar(e) an {name} schicken',
  commitPlaceholder: 'Commit-Nachricht',
  commitFileTooltip: 'Nur die gewählte Datei committen',
  commitFile: 'Datei committen',
  commitAll: 'Alles committen'
}

export default de
