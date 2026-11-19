import type en from '../en/library'

/** German texts: namespace `library` */
const de: typeof en = {
  // Prompt
  promptTitleEdit: 'Prompt bearbeiten',
  promptTitleNew: 'Neuer Prompt',
  promptNamePlaceholder: 'z. B. Code-Review',
  promptNameHelp:
    'Unter diesem Namen wählst du ihn aus – auch per Sprache („Agent 2, Prompt Code-Review“).',
  promptTextLabel: 'Anweisung',
  promptTextPlaceholder: 'z. B. Prüfe {{Datei}} auf Fehler und schlage Verbesserungen vor.',
  promptPlaceholdersFound: 'Platzhalter, die beim Senden abgefragt werden: {names}',
  promptPlaceholdersHelp:
    'Platzhalter in doppelten geschweiften Klammern, z. B. {{Datei}}, werden beim Senden abgefragt.',

  // Engine
  engineTitleEdit: 'Engine bearbeiten',
  engineTitleNew: 'Neue Engine',
  engineNamePlaceholder: 'z. B. Codex',
  engineNameHelp: 'So heißen die gestarteten Agents („Codex“, „Codex 2“ …).',
  engineCommandLabel: 'Befehl',
  engineCommandPlaceholder: 'z. B. codex   oder   gemini',
  engineCommandHelp:
    'Läuft als Terminal-Programm im Agent-Ordner (bzw. Worktree). Ohne Claude-Hooks gibt es für diese Agents keinen genauen Status, keine Datei-Reiter, Prüfungen oder Freigaben – Terminal, Raster, Sprach-Anweisungen, Aufträge und das Prüfen der Änderungen funktionieren.'
}

export default de
