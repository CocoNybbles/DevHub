import type en from '../en/tasks'

/** German texts: namespace `tasks` */
const de: typeof en = {
  title: 'Aufgaben',
  columnOpen: 'Offen',
  columnRunning: 'In Arbeit',
  columnDone: 'Erledigt',
  metaDone: 'erledigt {date}',
  metaDoneBy: 'erledigt {date} · {agent}',
  metaQueuedAt: 'wartet bei {agent}',
  metaCreated: 'angelegt {date}',
  startWithTooltip: 'Neuen Agent mit dieser Aufgabe starten',
  startWith: 'Starten mit …',
  startWithNewAgent: 'neuem Agent',
  assignTooltip: 'Einem laufenden Agent geben – er bearbeitet sie, sobald er fertig ist',
  assignTo: 'An Agent …',
  markDone: 'erledigt',
  reopen: 'wieder öffnen',
  delete: 'löschen',
  confirmDelete: 'Aufgabe löschen?',
  newTaskLabel: 'Neue Aufgabe',
  newTaskPlaceholder:
    'Was soll ein Agent tun? So ausführlich, dass er ohne Rückfrage loslegen kann.',
  create: 'Aufgabe anlegen'
}

export default de
