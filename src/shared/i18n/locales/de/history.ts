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
  endedEmpty: 'Noch keine. Beendete Agents erscheinen hier und lassen sich fortsetzen.',

  // Sitzung fortsetzen … (Sitzungen eines Projekts auf der Festplatte)
  localTitle: 'Sitzung fortsetzen – {project}',
  localFilter: 'Nach Titel, Anweisung, Branch oder Sitzungs-ID filtern …',
  localLoading: 'Suche Sitzungen …',
  localEmpty: 'Auf diesem Computer wurden keine Sitzungen dieses Projekts gefunden.',
  localSize: '{size} MB',
  localWorktree: 'Worktree {branch}',
  localRunningAs: 'läuft als {name}',
  localInHistoryAs: 'im Verlauf als {name}',
  localResumeTooltip: 'Agent starten, der diese Sitzung fortsetzt (claude --resume)',
  localForkTooltip:
    'Agent mit einer Kopie dieser Sitzung starten – das Original bleibt unverändert',
  localStarting: 'Startet …',
  localRecent: 'gerade eben aktiv – läuft sie woanders?',
  localConfirmActive:
    'In diese Sitzung wurde gerade eben noch geschrieben – vielleicht läuft sie noch in einem anderen Terminal. Dann würden zwei Prozesse in dieselbe Unterhaltung schreiben.\n\nTrotzdem fortsetzen? (Eine Kopie ist immer unbedenklich.)',
  localItemTooltip: 'Sitzung {id}\nin {cwd}',
  localTeam: 'ehemaliges Team-Mitglied',
  localTeamTooltip:
    'Wird als einzelner Agent ohne sein Team fortgesetzt: Die in der Unterhaltung erwähnten Team-Werkzeuge (Nachrichten, Freigaben) funktionieren nicht mehr.',
  localHelp:
    'Alle Claude-Code-Sitzungen, die im Agent-Ordner oder in einem Worktree des Projekts liefen – auch außerhalb von DevHub gestartete. Neueste zuerst, höchstens 100.'
}

export default de
