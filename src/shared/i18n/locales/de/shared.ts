import type en from '../en/shared'

/** German texts: namespace `shared` */
const de: typeof en = {
  // agentArgs.ts – validation of the start flags
  argsUnclosedQuote: 'Anführungszeichen nicht geschlossen',
  argsNotAFlag: '„{token}“ ist kein Flag – Flags beginnen mit - oder --',
  argsReservedRestore: '{flag} ist nicht erlaubt (setzt DevHub für die Wiederherstellung selbst)',
  argsReservedContinue: '{flag} ist nicht erlaubt (würde eine andere Session fortsetzen)',
  argsReservedFork:
    '{flag} ist nicht erlaubt (würde die Session-ID ändern (keine Wiederherstellung))',
  argsReservedNoPersistence: '{flag} ist nicht erlaubt (verhindert die Wiederherstellung)',
  argsReservedSettings:
    '{flag} ist nicht erlaubt (setzt DevHub selbst (Hooks für die Statusanzeige))',
  argsReservedMcp: '{flag} ist nicht erlaubt (setzt DevHub selbst (Code-Ansicht))',
  argsReservedOwn: '{flag} ist nicht erlaubt (setzt DevHub selbst)',
  argsReservedPrint: '{flag} ist nicht erlaubt (beendet den Agent nach einer Antwort)',
  argsReservedNoAgent: '{flag} ist nicht erlaubt (startet keinen Agent)',

  // permissions.ts – permission rules
  ruleEmpty: 'Regel ist leer',
  ruleBashPrefixMissing: 'Nach „Bash:“ fehlt der Befehlsanfang',
  ruleCompound: 'Befehlsanfang darf keine Verkettung/Umleitung enthalten',
  ruleInvalidToolName: 'Ungültiger Tool-Name: {name}',

  // permissions.ts – activity of an agent (one line per tool call)
  toolRead: 'Liest {file}',
  toolEdit: 'Bearbeitet {file}',
  toolWrite: 'Schreibt {file}',
  toolGrep: 'Sucht „{pattern}“',
  toolGlob: 'Sucht Dateien {pattern}',
  toolSubagent: 'Subagent: {text}',
  toolWebFetch: 'Lädt {url}',
  toolWebSearch: 'Websuche: {query}',
  toolTodoWrite: 'Aktualisiert die Aufgabenliste',
  toolAskUser: 'Stellt eine Frage',

  // hotkeys.ts – key names in displayed shortcuts
  keyControl: 'Strg',
  keySuper: 'Win',
  keySpace: 'Leertaste',
  keyDelete: 'Entf',
  keyInsert: 'Einfg',
  keyHome: 'Pos1',
  keyEnd: 'Ende',
  keyPageUp: 'Bild↑',
  keyPageDown: 'Bild↓',
  keyEnter: 'Enter',
  keyBackspace: 'Rück'
}

export default de
