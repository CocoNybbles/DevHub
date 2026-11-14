import type en from '../en/settings'

/** German texts: namespace `settings` */
const de: typeof en = {
  // Interface language
  languageTitle: 'Sprache',
  languageLabel: 'Sprache der Oberfläche',
  languageSystem: 'Systemsprache',

  // Agent start
  agentStartTitle: 'Agent-Start',
  agentArgsLabel: 'Zusätzliche Start-Flags für alle Agents',
  agentArgsPlaceholder: 'z. B. --permission-mode auto',
  argsHelpGlobal: 'Werden an jeden neu gestarteten oder wiederhergestellten Agent übergeben.',
  argsHelpProject:
    'Ergänzen die globalen Flags aus den Einstellungen; gleichnamige Flags ersetzen die globalen.',
  argsHelpExamples: 'Beispiele:',
  argsHelpApplies: 'Gilt ab dem nächsten Agent-Start.',

  // Predefined agents
  templatesTitle: 'Vordefinierte Agents',
  templateModelFromFlags: 'Modell aus Start-Flags',
  confirmDeleteTemplate: 'Vorlage „{name}“ löschen?',
  newTemplate: 'Neuer vordefinierter Agent …',
  templatesHelp:
    'Benannte Agents mit eigenem Modell und eigenen Richtlinien. Start über den ▶-Button am Projekt oder per Sprache („Starte einen Entwickler für DevHub, der …“); laufende sprichst du mit ihrem Namen an.',

  // Teams
  confirmDeleteTeam: 'Team „{name}“ löschen?',
  newTeam: 'Neues Team …',
  teamsHelp:
    'Mehrere Agents, die zusammen für ein Projekt starten und sich Nachrichten schicken dürfen. Start über ▶ am Projekt oder per Sprache („Starte das Team Feature für DevHub“). Per Sprache geht auch ein temporäres Team: „Starte einen Entwickler und einen Reviewer als Team für DevHub, …“.',

  // Prompt library
  promptsTitle: 'Prompt-Bibliothek',
  confirmDeletePrompt: 'Prompt „{name}“ löschen?',
  newPrompt: 'Neuer Prompt …',
  promptsHelp:
    'Wiederverwendbare Anweisungen mit Platzhaltern. Senden: Rechtsklick auf einen Agent → „Auftrag / Prompt aus der Bibliothek“ oder per Sprache („Agent 2, Prompt Code-Review“).',

  // Other engines
  enginesTitle: 'Weitere Engines',
  confirmDeleteEngine: 'Engine „{name}“ löschen?',
  newEngine: 'Neue Engine …',
  enginesHelp:
    'Andere Coding-Agents als Claude Code (z. B. Codex CLI, Gemini CLI) als Terminal-Programm. Start über ▶ am Projekt. Ohne Claude-Hooks nur mit vereinfachtem Status.',

  // Inbox and notifications
  inboxTitle: 'Eingang und Benachrichtigungen',
  notifyOnWaiting: 'Windows-Benachrichtigung, wenn ein Agent wartet und DevHub im Hintergrund ist',
  permissionInbox: 'Freigaben im Eingang entscheiden (statt im Terminal des Agents)',
  permissionInboxHelp:
    'Mit „Immer“ entsteht eine Regel fürs Projekt (Projekt bearbeiten → Freigabe-Regeln). Regeln gelten auch ohne diese Einstellung.',
  voiceReadback: 'Fertige Agents: Kurzfassung der Antwort vorlesen',
  voiceReadbackHelp:
    'Claude (Haiku) fasst die Antwort in ein bis zwei Sätzen zusammen; vorgelesen wird mit der Windows-Sprachausgabe.',

  // Usage
  usageTitle: 'Verbrauch',
  contextWarnLabel: 'Kontext-Warnung ab (Tokens)',
  contextWarnHelp: 'Hinweis im Eingang, sobald die Unterhaltung eines Agents so groß ist. 0 = aus.',
  priceInputLabel: 'Preis Eingabe (USD je Million Tokens)',
  priceInputHelp: 'Für die Kostenschätzung im Verlauf. 0 = keine Kostenanzeige (z. B. mit Abo).',
  priceOutputLabel: 'Preis Ausgabe (USD je Million Tokens)',
  priceOutputHelp:
    'Cache-Lesen wird mit 10 %, Cache-Schreiben mit 125 % des Eingabepreises gerechnet.',

  // Remote access
  remoteTitle: 'Fernzugriff',
  remoteEnable: 'Fernzugriff im lokalen Netz einschalten (z. B. fürs Handy)',
  remoteHelp:
    'Zeigt die Agents mit Status und letzter Antwort, nimmt Anweisungen an und entscheidet Freigaben aus dem Eingang. Die Verbindung ist unverschlüsselt (HTTP) und nur durch den geheimen Teil der Adresse geschützt – nur in einem vertrauenswürdigen Netz bzw. über ein VPN nutzen. Windows fragt beim ersten Einschalten ggf. nach der Firewall-Freigabe.',
  remotePort: 'Port',
  remoteNoAddress: 'Keine Netzwerkadresse gefunden.',
  remoteCopy: 'kopieren',
  remoteNewAddressTooltip:
    'Erzeugt eine neue Adresse – bisherige Links funktionieren danach nicht mehr',
  remoteNewAddress: 'Neue Adresse erzeugen',

  // File preview
  filePreviewTitle: 'Dateivorschau',
  showEditedFiles: 'Vom Agent bearbeitete Dateien rechts als Reiter anzeigen',
  showEditedFilesHelp:
    'Geänderte Zeilen werden hervorgehoben. Stellen, die ein Agent gezielt zeigt, und Snippets erscheinen unabhängig davon.',

  // Open with
  openWithTitle: 'Öffnen mit',
  projectFileAppLabel: 'Projektdateien (Pfad 2)',
  projectFileAppPlaceholder: 'Windows-Standardprogramm der Dateiendung',
  projectFileAppHelp:
    'Pfad zur .exe, z. B. Visual Studio oder Rider. Leer = Programm, das Windows für die Dateiendung verwendet.',
  folderAppLabel: 'Ordner (Pfad 3)',
  windowsExplorer: 'Windows-Explorer',
  folderAppHelpVscode:
    'Pfad zur .exe, z. B. VS Code, Cursor oder ein anderer Editor. Leer = VS Code.',
  folderAppHelpExplorer:
    'Pfad zur .exe, z. B. VS Code, Cursor oder ein anderer Editor. Leer = Windows-Explorer (VS Code ist nicht installiert).',
  openWithPerProject: 'Beides ist pro Projekt abweichend einstellbar.',
  programUseDefault: 'Standard verwenden',
  programReset: 'Zurücksetzen',

  // Voice
  voiceModelTitle: 'Sprachmodell',
  voiceTitle: 'Sprach-Anweisungen',
  voiceAutoSend: 'Erkannten Text direkt abschicken (sonst nur ins Terminal eintragen)',
  voiceAutoSendHelp: 'Pro Agent abweichend einstellbar: Rechtsklick auf den Agent in der Liste.',
  spokenLanguageLabel: 'Gesprochene Sprache',
  spokenLanguageAuto: 'Automatisch erkennen',
  spokenLanguageAlways: 'Immer {language}',
  spokenLanguageFixedHelp:
    'Feste Sprache: am schnellsten und zuverlässigsten. Andere Sprachen werden dann allerdings falsch erkannt bzw. übersetzt.',
  voiceRememberLanguage:
    'Zuletzt erkannte Sprache merken und zuerst verwenden (schnellere Erkennung)',
  rememberedBefore: 'Gemerkt: ',
  rememberedAfter: ' – wirkt das Ergebnis unsicher, wird die Sprache neu erkannt.',
  rememberedForget: 'Vergessen',
  rememberedNone:
    'Noch keine Sprache gemerkt – wird bei der nächsten Aufnahme erkannt. Englisch wird nie gemerkt (whisper würde sonst andere Sprachen ins Englische übersetzen).',

  // Hotkeys
  hotkeysTitle: 'Tastenkürzel',
  hotkeyAgentVoice: 'Sprach-Anweisung an den aktiven Agent (in der App)',
  hotkeyGlobalVoice: 'Sprachbefehl systemweit: Agent per Name ansprechen oder neuen Agent starten',
  hotkeyEditor:
    'Anweisung für den aktiven Agent in einem Tab schreiben (mit Diktat und Bildern; in der App)',
  hotkeyCancelRecording: 'Laufende Aufnahme abbrechen',
  hotkeysHelp:
    'Erneutes Drücken des Kürzels beendet die Aufnahme. Zum Ändern auf „Ändern“ klicken und die neue Tastenkombination drücken (mit Strg, Alt oder Win, oder eine F-Taste).',
  hotkeyNeedsModifier: 'Mit Strg, Alt oder Win kombinieren (oder eine F-Taste verwenden)',
  hotkeyPress: 'Tastenkombination drücken … (Esc = Abbrechen)',
  hotkeyChange: 'Ändern'
}

export default de
