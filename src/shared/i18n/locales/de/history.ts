import type en from '../en/history'

/** German texts: namespace `history` */
const de: typeof en = {
  title: 'Verlauf',
  removedProject: '(entferntes Projekt)',
  usage: '{input} ein · {output} aus',
  usageWithCost: '{input} ein · {output} aus · ≈ {cost}',
  entryMeta: '· {project} · beendet {date}',
  entryMetaWorktree: '· {project} · beendet {date} · Worktree {branch}',
  noInstruction: '(ohne Anweisung)',
  resumeTooltip: 'Sitzung als Agent weiterführen',
  resume: 'Fortsetzen',
  forkTooltip: 'Als Kopie weiterführen – der Eintrag bleibt im Verlauf',
  fork: 'Abzweigen',
  removeTooltip: 'Nur aus dem Verlauf entfernen (das Transkript bleibt auf der Platte)',
  remove: 'entfernen',
  searchPlaceholder: 'In allen Unterhaltungen suchen (laufende und beendete) …',
  searching: 'Suche …',
  search: 'Suchen',
  back: 'Zurück',
  noMatches: 'Keine Treffer.',
  matchMetaRunning: '· {project} · läuft',
  matchMetaEnded: '· {project} · beendet',
  show: 'Anzeigen',
  usageHeading: 'Verbrauch',
  usageToday: 'Heute',
  usageTotal: 'Gesamt (bekannte Sitzungen)',
  costHint: 'Für eine Kostenschätzung die Preise je Million Tokens in den Einstellungen eintragen.',
  endedHeading: 'Beendete Sitzungen',
  endedEmpty: 'Noch keine. Beendete Agents erscheinen hier und lassen sich fortsetzen.'
}

export default de
