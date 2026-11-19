import type en from '../en/git'

/** German texts: namespace `git` */
const de: typeof en = {
  gitNotFound: 'git wurde nicht gefunden (ist Git installiert und im PATH?)',
  noCommitYet: 'Das Repository hat noch keinen Commit – Worktrees brauchen einen.',
  invalidPath: 'Ungültiger Pfad: {path}',
  commitMessageMissing: 'Commit-Nachricht fehlt',
  uncommittedChanges: 'Im Worktree gibt es noch nicht committete Änderungen – zuerst committen.',
  noNewCommits: 'Der Branch enthält keine neuen Commits.',
  merged: 'In „{target}“ zusammengeführt.',
  mergeFailed: 'Zusammenführen in „{target}“ fehlgeschlagen (abgebrochen, nichts geändert):'
}

export default de
