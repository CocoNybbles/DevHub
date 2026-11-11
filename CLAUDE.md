# DevHub

> **Pflegeregel (immer befolgen):** Diese Datei wird während der Arbeit laufend aktuell gehalten.
> Nach jeder relevanten Änderung (neuer Tech-Stack, neue Befehle, Ordnerstruktur, Architekturentscheidungen,
> Konventionen, Setup-Schritte, bekannte Stolpersteine) wird CLAUDE.md im selben Arbeitsschritt angepasst.
> Veraltete Angaben werden entfernt statt ergänzt. Kurz und präzise halten.

## Projektüberblick

Lokale Windows-Desktop-App zum Verwalten von Projekten und den darin laufenden KI-Coding-Agents (Claude Code).

### Anforderungen

**Projekte**

- Projekte (Ordner) registrieren, je Projekt 3 Pfade:
  1. Agent-Pfad: Arbeitsverzeichnis, in dem Claude / andere KI-Coding-Engines gestartet werden
  2. Projektdatei: `.sln` / Projektdatei, öffnbar z. B. mit Visual Studio — wird nach Wahl des Agent-Ordners automatisch gesucht (`findSolution` in `main/tools.ts`: `.sln`/`.slnx`, bis 3 Ebenen tief, flachste zuerst, Name = Ordnername bevorzugt; überschreibt nie eine von Hand gesetzte Datei)
     Öffnen mit: `project.projectFileApp` → global `settings.projectFileApp` → Windows-Standardprogramm (`shell.openPath`). Icon neutral (`OpenFileIcon`), nicht VS-spezifisch.
  3. Ordner (`folderPath`, früher `vscodePath` – `getState()` übernimmt alte Stände): immer konfigurierbar. Öffnen mit: `project.folderApp` → global `settings.folderApp` → VS Code (falls installiert) → Windows-Explorer
  - Programme = absoluter Pfad zu `.exe`/`.cmd`/`.bat` (`validateProgram`/`openWithProgram` in `main/tools.ts`, losgelöst gestartet, cwd = Ordner bzw. Ordner der Datei), Eingabe per `ProgramInput`, Einstellungen-Abschnitt „Öffnen mit“
  - Ausnahme: „In VS Code öffnen“ in der Code-Ansicht (`code:openInVSCode`, springt zur Zeile) bleibt VS-Code-spezifisch

**Layout**

- Links: Liste aller Projekte mit ihren Agents
  - Kleiner Button neben dem Projektnamen startet einen neuen Agent
  - Agents heißen standardmäßig „Agent 1“, „Agent 2“, … — Rechtsklick-Menü: Umbenennen, Beenden, Sprachtext abschicken/eintragen (pro Agent)
  - Agents, die eine Frage/Input brauchen, werden hervorgehoben, bis sie weiterarbeiten — links in der Liste und im Raster (gelber Rahmen + Frage im Zellenkopf, `.grid-cell.attention`; aktiv + wartend = gelber Rahmen mit Akzentlinie unter dem Kopf)
  - Agents können über die Liste beendet werden
  - **Sortieren:** Projekte per Drag & Drop + Button „A→Z“ im Kopf (`localeCompare` mit `numeric`); Agents per Drag & Drop nur innerhalb ihrer Gruppe (Projekt ohne Team bzw. Team), dazu Rechtsklick „… nach Name sortieren“. Reihenfolge = Reihenfolge der Arrays `state.projects`/`state.agents` (`projects:reorder`, `agents:reorder` → `applyOrder` in `store.ts`, ordnet nur die übergebenen Ids um); `AgentManager.list()` liefert in dieser Reihenfolge (gilt auch fürs Raster)
- Mitte: Terminal des ausgewählten Agents (`claude.exe` direkt per ConPTY, **ohne** Shell dazwischen – so beendet `/exit` den Agent wirklich)
  - Klick auf ein Projekt → alle Agents des Projekts im Raster
  - **Strg+Klick** (projektübergreifend): Agent zum Raster hinzufügen/entfernen; auf ein Projekt = alle seine Agents. Ausgangspunkt ist die aktuelle Ansicht (auch ein Projekt-Raster). Auswahl-Typ `{ kind: 'agents', agentIds }`, Logik in `lib/selection.ts`; 1 Agent → Einzelansicht, 0 → leer
  - Beendet sich ein Agent im Terminal selbst (z. B. `/exit`), wird die Ansicht geschlossen und der Eintrag links entfernt
- Rechts: Code-Ansicht — bei Analyse/Bugfund wird die betroffene Datei angezeigt und die Stelle hervorgehoben
  - Spalte wird **nur eingeblendet, solange eine Datei angezeigt wird** (Fokus für den aktiven Agent / das ausgewählte Projekt), sonst nimmt das Terminal die Breite ein (`.layout.with-code`)

**Sitzungen**

- Beim Beenden der App laufende Agents werden beim nächsten Start mit ihrer Session wiederhergestellt

**Sprachsteuerung**

- Button + Hotkey: Sprach-Anweisung an den aktiven Agent
- Globaler Button + Hotkey: Agent per Name ansprechen; ebenso per Sprache einen neuen Agent für ein Projekt mit Aufgabe starten
- Interpretation der Sprachbefehle über eine eigene Claude-Instanz mit dem lokal vorhandenen Account

**Vordefinierte Agents (Vorlagen)**

- Einstellungen → „Vordefinierte Agents“: Name (eindeutig, nicht „Agent N“, endet nicht auf Zahl), Modell (optional), Rolle/Richtlinien (Textfeld mit Diktat-Button `DictationButton`)
- Start: ▶ am Projekt bzw. Rechtsklick (Auswahl normal/Vorlage) oder per Sprache („Starte einen Entwickler für DevHub …“); Agent heißt wie die Vorlage („Entwickler“, „Entwickler 2“ …) → per Name ansprechbar
- Modell: per Sprache genannt > Vorlage > Start-Flags. Richtlinien werden an `--append-system-prompt` angehängt (`systemPrompt()` in `agents.ts`). Agent speichert nur `templateId`; Vorlage wird bei jedem Start frisch gelesen (gelöschte Vorlage → Start ohne Richtlinien). Vorlage, die in einem Team steckt, kann nicht gelöscht werden

**Teams**

- Team-Vorlagen (`TeamTemplate`, Einstellungen → „Teams“, `TeamTemplateDialog`): Name (nicht „Team N“), 2–8 Mitglieder (vordefinierte oder normale Agents, Reihenfolge änderbar), gemeinsame Richtlinien (`DictationTextarea`)
- Laufendes Team (`Team`, `state.teams`): aus Vorlage oder **temporär** per Sprache („Starte einen Entwickler und einen Reviewer als Team für …“, Name sonst „Team N“). Agents tragen `teamId`; Team verschwindet mit dem letzten Mitglied (`removeEmptyTeams`)
- `AgentManager.startTeam`: erst alle Agents speichern (Namen + Teamkollegen fest, `createdAt` fortlaufend → Reihenfolge eindeutig), dann starten. **Erstes Mitglied leitet** (= kleinstes `createdAt`, **nicht** die Anzeigereihenfolge, die frei sortierbar ist; Sidebar markiert es mit „Leitung“) und bekommt die Aufgabe; System-Prompt (`teamContext`) erklärt Rolle, Kollegen, Team-Richtlinien
- Kommunikation: MCP-Tools `team_members` + `send_team_message(to|"all", message)` nur für Teammitglieder (Bridge fragt `tools(agentId)`), nur innerhalb des Teams. Zustellung = `sendLine` ins Terminal des Empfängers mit Präfix `[Team message from X]`; vor erster Ausgabe gepuffert (`pending`), nicht bei offener `AskUserQuestion`
- Links: Teamkopf (Icon, „temporär“, Anzahl, ✕ = Team beenden) mit eingerückten Mitgliedern; Klick = Raster (`kind: 'agents'`), Strg+Klick = hinzufügen/entfernen (`toggleAgents`)
- Sprache: `start_team` (Vorlage oder `members`-Liste) · laufendes Team per Name ansprechen → geht an die Leitung

**Start-Prüfung**

- Beim App-Start prüfen, ob Claude Code installiert und eingeloggt ist; ist die Anmeldung abgelaufen, muss der Nutzer sich zuerst neu anmelden

## Tech-Stack

- **Electron + TypeScript** (entschieden 2026-11-10: am stabilsten, einfach zu verteilen)
- Build: electron-vite (Vite 8), Electron 44, electron-builder 26 — nur Windows, **nur portable .exe — bewusst kein Installer** (Deinstallieren = Ordner löschen, Daten liegen in `data\` daneben)
- UI: React 19, reines CSS (`assets/main.css` = Variablen/Basis, `assets/components.css` = Komponenten), Dark Theme
- Terminal: `@xterm/xterm` 6 + `@xterm/addon-fit` (Renderer), `node-pty` 1.1 (Main, ConPTY, N-API-Prebuilds)
- Code-Ansicht: `monaco-editor` 0.57, **schlanker Import** (`monaco-editor/editor/editor.api` + `basic-languages/monaco.contribution` + nur `editor.worker`)
- Sprache → Text: whisper.cpp lokal (Release `b5454`, `whisper-bin-x64.zip`), mehrsprachige quantisierte Modelle, Sprache automatisch (`-l auto`) bzw. gemerkt (s. Architektur)
  - Engine (~9 MB) **und** Modell werden **nicht** mitgeliefert, sondern beim ersten Nutzen nach `<data>\whisper\` geladen (Datenordner neben der .exe, s. Architektur)
  - Erster Voice-Versuch ohne Modell → `VoiceSetupDialog` (Modellauswahl base ~60 MB / small ~190 MB [Standard] / large-v3-turbo ~550 MB, Download mit Fortschritt direkt im Dialog)
  - Einstellungen: dieselbe Auswahl (`VoiceModels`), Modell wechseln/löschen
- Laufzeit-Abhängigkeiten (`dependencies`) nur: `node-pty`, `@electron-toolkit/utils`. Alles, was Vite bündelt (React, xterm, Monaco), gehört in `devDependencies` (sonst landet es doppelt im Paket).

## Architektur

**Agent-Start** (`main/agents.ts`): `claude.exe` direkt per node-pty im Agent-Ordner (bei `.cmd`-Installation via `cmd.exe /c`, Sonderzeichen werden entfernt):
`claude [Nutzer-Flags]  --session-id <uuid> | --resume <uuid>  --settings <agent>/settings.json  --mcp-config <agent>/mcp.json  --append-system-prompt <Hinweis> [Aufgabe]`

- **Nutzer-Flags** (`shared/agentArgs.ts`): global `settings.agentArgs` + pro Projekt `project.agentArgs`, Text wie in einer Shell (Quotes, Backslashes bleiben). `mergeAgentArgs(global, projekt, agent)`: gleichnamiges Flag einer höheren Ebene ersetzt das niedrigere; Ebene „agent“ = `agent.model` (per Sprachbefehl genannt, persistiert) oder sonst Modell der Vorlage → `--model` (gilt auch bei Wiederherstellung; geprüft mit `isValidModelName`). Stehen **vor** den DevHub-Flags (beendet variadische Werte, Aufgabe bleibt positional). `validateAgentArgs` (Dialoge live + Main beim Speichern) lehnt freien Text und reservierte Flags ab (`--session-id`, `--resume`/`-r`, `--continue`/`-c`, `--fork-session`, `--no-session-persistence`, `--settings`, `--mcp-config`, `--append-system-prompt`, `--print`/`-p`, `--help`, `--version`). Unbekannte Flags prüft erst claude selbst → Startfehler (s. u.).
- `--resume` nur, wenn `~/.claude/projects/*/<sessionId>.jsonl` existiert, sonst `--session-id` (gleiche ID)
- Pro-Agent-Dateien in `<data>\agents\<agentId>\` (bei jedem Start neu geschrieben, da Port/Token wechseln)
- Env ohne Session-Marker einer übergeordneten Claude-Instanz (`claudeEnv()` in `main/tools.ts`)

**Rückkanal Agent → App** (`main/agentBridge.ts`): HTTP-Server auf `127.0.0.1:<zufälliger Port>` mit Zufalls-Token

- `POST /hook/<token>/<agentId>`: Hooks posten ihr JSON per `curl.exe … --data-binary @-`
  Status: `SessionStart`→idle · `UserPromptSubmit`/`PreToolUse`/`PostToolUse`→working · `PreToolUse(AskUserQuestion)`/`Notification`/`Stop`→**needsInput** (links hervorgehoben)
- `POST /mcp/<token>/<agentId>`: minimaler MCP-Server (Streamable HTTP, nur JSON-Antworten) mit Tool `show_code(file_path, start_line, end_line?, note?)` → Event `code:focus` → Monaco rechts; für Teammitglieder zusätzlich `team_members`/`send_team_message` (s. Teams). Tools sind per `permissions.allow` freigegeben.

**Agent-Lebenszyklus**

- Namen: kleinste freie Nummer **global** („Agent N“) → eindeutig für Sprachbefehle
- Prozess endet (`/exit` oder ✕ in der Liste) → Agent aus Zustand entfernt, Ansicht schließt sich
- Startfehler: endet ein Agent < 8 s nach Start mit Exit-Code ≠ 0 (nicht per ✕), meldet Main `agents:startFailed` mit den letzten Ausgabezeilen (ohne ANSI) → Toast
- App wird beendet (`before-quit`) → Prozesse gestoppt, Agents bleiben gespeichert → beim nächsten Start `agents:restore` (einmal pro App-Start)
- Wartezustand überlebt Neustarts: `setStatus` speichert `needsInput` (Hinweistext) am gespeicherten Agent; Wiederherstellung startet mit diesem Status, `SessionStart` mit `source: "resume"` setzt ihn nicht auf idle zurück (erst `UserPromptSubmit`/Tool-Hooks)

**Terminals im Renderer** (`lib/terminals.ts`): ein xterm pro Agent, lebt unabhängig von React und sammelt Ausgabe auch unsichtbar; `attachTerminal()` hängt das DOM-Element in Einzelansicht oder Rasterzelle. Main hält zusätzlich 200 KB Ausgabe-Puffer (`agents:buffer`) für Renderer-Reloads.

**Sprachsteuerung**: Renderer nimmt WAV auf (`lib/recorder.ts`, 16 kHz mono) → `voice:transcribe` (whisper-cli, Priorität „niedriger als normal“, Threads = halbe Kerne) →

- **Feste Sprache** (`settings.voiceFixedLanguage`, Einstellungen „Gesprochene Sprache“: Automatisch / Immer Deutsch / Immer Englisch): immer `-l <code>`, keine Erkennung, Merken entfällt.
- **Sprache merken** (`settings.voiceRememberLanguage`, Standard an; gemerkt in `settings.voiceLanguage`): zuerst `-l <gemerkt>` (≈1,5 s statt ≈3 s mit `auto`). Auswertung per `-ojf` (JSON: Sprache + Token-Wahrscheinlichkeit `p`). Leeres Ergebnis oder Ø p < 0,6 → zweiter Lauf mit `auto`, dessen Sprache gespeichert wird. **Englisch wird nie gemerkt/vorgegeben** (`canRememberLanguage` in `shared/voiceLanguage.ts`): bei `-l en` übersetzt whisper deutsche Sprache ins Englische mit p = 0,66 (gemessen, Modell small) → Prüfung greift nicht (war ein Nutzer-Bug). Erzwungenes `de` bei englischer Sprache ergibt dagegen p ≈ 0,5. Zur Sicherheit weiterhin jede 5. Aufnahme `auto`. Die Job-Karte zeigt die gemerkte Sprache vorab (`[DE] Wandle in Text um …`), ohne gemerkte Sprache „Erkenne Sprache und Text …“; nach einem `auto`-Lauf lädt der Renderer die Einstellungen neu.
- **Hintergrund:** „Fertig“ beendet nur die Aufnahme; Erkennung/Zuordnung laufen als `VoiceJob` weiter (Karten unten in der Mitte, mehrere gleichzeitig), neue Aufnahmen sind sofort möglich. Overlay lässt Klicks durch (`.voice-stack` mit `pointer-events: none`).
- **Abschicken oder nur eintragen:** `agents:sendVoice` entscheidet im Main: `agent.voiceAutoSend` (pro Agent, Rechtsklick-Menü, persistiert) → sonst global `settings.voiceAutoSend`. Gilt auch für globale Befehle (`send`).
- aktiver Agent (Standard `Strg+Shift+Leertaste` / Mikrofon in der Mitte): Text an Agent (`sendLine` = Text, 150 ms, Enter)
- global (Standard `Strg+Alt+Leertaste` per `globalShortcut` / Mikrofon links): `voice:command` → `claude -p --model haiku --output-format json --tools "" --strict-mcp-config --no-session-persistence` (Prompt via stdin) liefert JSON `send` | `start` (+ optional `model`: Alias `fable`/`opus`/`sonnet`/`haiku`, bei genannter Version voller Name wie `claude-opus-5-5`) | `none`
- **Kürzel einstellbar** (Einstellungen → `HotkeyInput`): gespeichert als Electron-Accelerator in `settings.hotkeyAgentVoice` / `hotkeyGlobalVoice`. `shared/hotkeys.ts` übersetzt Tastendrücke (layoutunabhängig über `KeyboardEvent.code`) und formatiert die Anzeige. Main registriert das globale Kürzel neu (`registerGlobalHotkey`; belegt → altes zurück + Fehler im Dialog); während der Aufnahme wird es per `settings:suspendGlobalHotkey` freigegeben. Das Agent-Kürzel lässt das Terminal per `setAppHotkeys()` durch.

**Datenordner** (`main/dataPath.ts`, erster Import in `index.ts`): **alle Daten neben der .exe** in `<exe-Ordner>\data\` (`app.setPath('userData')` vor `ready`, also auch Chromium-Cache). Portable: `PORTABLE_EXECUTABLE_DIR` (nicht der Entpack-Ordner in `%TEMP%`); Entwicklung: `<Projekt>\data\` (gitignored). Nicht beschreibbar → Fehlermeldung + Beenden. Einmalige Übernahme von `devhub-state.json` + `whisper\` aus dem alten `%APPDATA%\DevHub`. Im Folgenden `<data>`.

**Persistenz** (`main/store.ts`): `<data>\devhub-state.json` (Projekte, laufende Agents, Einstellungen, `view` = zuletzt gezeigte Ansicht), atomar geschrieben.

- Ansicht (`Selection` in `shared/types.ts`): Renderer speichert jede Änderung per `view:set` (erst nachdem `view:get` beim Start geladen wurde, Ref `viewLoaded`); beim Start `savedView` → sonst erstes Projekt mit Agents. Nicht mehr laufende Agents filtert `selection` (useMemo) heraus → `agents` vor der Auswahl setzen.

## Befehle

| Zweck                                                        | Befehl                            |
| ------------------------------------------------------------ | --------------------------------- |
| Entwicklung (Hot Reload)                                     | `npm run dev`                     |
| Typprüfung                                                   | `npm run typecheck`               |
| Lint / Format                                                | `npm run lint` / `npm run format` |
| Build (Typcheck + Bundle nach `out/`)                        | `npm run build`                   |
| Entpacktes Paket zum Testen (`dist/win-unpacked/DevHub.exe`) | `npm run build:unpack`            |
| Portable .exe nach `dist/`                                   | `npm run build:win`               |

**Debug-Umgebungsvariablen**

- `DEVHUB_DEBUG=1`: loggt Agent-Starts, Hook-Ereignisse und MCP-Aufrufe in die Konsole
- `DEVHUB_SCREENSHOT=<pfad.png>` (+ `DEVHUB_SCREENSHOT_DELAY=<ms>`, Standard 8000): speichert ein Fensterbild und loggt den DOM-Zustand (Agent-Zeilen, Code-Notiz)

## Projektstruktur

```
src/
  shared/types.ts          Gemeinsame Typen + DevHubApi
  shared/hotkeys.ts        Kürzel: Standardwerte, Tastendruck → Accelerator, Anzeigeformat
  shared/agentArgs.ts      Start-Flags: Tokenizer, Validierung, Zusammenführen global/Projekt
  shared/voiceLanguage.ts  Welche Sprache gemerkt werden darf (nie Englisch), Auswahl feste Sprache
  main/
    index.ts               Fenster, IPC-Handler, globaler Hotkey, Mikrofon-Berechtigung
    agents.ts              AgentManager: node-pty, Start/Stop/Rename/Restore, Hook-Status, show_code
    agentBridge.ts         Lokaler HTTP-Server: Hooks + MCP (show_code)
    dataPath.ts            Datenordner neben der .exe (vor allem anderen importiert)
    store.ts               JSON-Persistenz, dataDir()
    tools.ts               claude/VS-Code-Erkennung, claudeEnv(), openInVSCode(), openWithProgram()
    claudeAuth.ts          `claude auth status --json`, Login-Konsole
    voice.ts               whisper.cpp-Download/Transkription, Modellverwaltung
    voiceCommands.ts       Globale Sprachbefehle via `claude -p`
    voicePrompt.ts         Router-Prompt (rein, per esbuild-Skript mit echtem claude testbar)
  preload/index.ts         window.api (contextBridge)
  renderer/src/
    App.tsx                Auth-Gate → Workspace; Typ `Selection`
    Workspace.tsx          Zustand, Auswahl, Sprachablauf, Hotkeys, Dialoge
    lib/                   terminals.ts, recorder.ts, errors.ts, hotkeyCapture.ts, selection.ts
    components/            Sidebar, CenterPane, TerminalView, CodePane, ProjectDialog, SettingsDialog,
                           VoiceSetupDialog, VoiceModels, VoiceOverlay, HotkeyInput, ProgramInput, AgentArgsHelp, Modal,
                           AgentTemplateDialog, TeamTemplateDialog, DictationButton, DictationTextarea,
                           ContextMenu, AuthGate, Icons
electron-builder.yml       Windows-Ziele, asarUnpack node-pty, nur Sprachen de/en-US
```

**IPC-Muster:** Kanal `bereich:aktion` (z. B. `agents:start`) → Handler in `main/index.ts`, Methode in `preload/index.ts`,
Typ in `DevHubApi` (`shared/types.ts`). Alle drei immer zusammen anpassen. Ereignisse Main→Renderer: `agents:data`,
`agents:changed` (Agents + laufende Teams), `agents:startFailed`, `code:focus`, `voice:progress`, `voice:globalHotkey` (Abo liefert Abmelde-Funktion).

## Stand

- [x] Login-Prüfung beim Start (blockiert App bis eingeloggt)
- [x] Projekte anlegen/bearbeiten/entfernen (3 Pfade), Projektdatei / Ordner öffnen mit wählbarem Programm (global + pro Projekt; Start mit Leerzeichen-Pfaden getestet, **Dialoge in der UI noch nicht getestet**)
- [x] Agents starten/umbenennen (Rechtsklick)/beenden, Terminal, Raster-Ansicht, Selbstbeendigung schließt Ansicht
- [x] Input-Erkennung via Hooks, Hervorhebung links — **getestet**
- [x] Code-Ansicht + MCP `show_code` — **Ende-zu-Ende getestet**
- [x] Session-Wiederherstellung — Speichern/Neustart getestet; `--resume` mit echtem Transkript noch **nicht** getestet
- [x] Sprachsteuerung inkl. Download-Dialog — Routing via `claude -p` getestet; **whisper-Download/Transkription + Mikrofon noch nicht getestet**
- [x] Sprach-Kürzel in den Einstellungen änderbar — Build/Typcheck ok, **in der UI noch nicht getestet**
- [x] Start-Flags global + pro Projekt — Parser getestet, claude-Verhalten per PTY geprüft (unbekanntes Flag → Exit 1, `--enable-auto-mode` ist gültig, aber undokumentiert); **in der UI noch nicht getestet**
- [x] Freies Raster per Strg+Klick — Auswahl-Logik per Skript getestet, **in der UI noch nicht getestet**
- [x] Projekte/Agents sortieren (Drag & Drop, A→Z) — Build/Lint ok, App startet; **Ziehen in der UI noch nicht getestet**
- [x] Teams (fest + temporär per Sprache, Kommunikation per MCP) — Router mit echtem `claude -p` getestet (6 Fälle: Team-Vorlage, Ad-hoc-Team mit Aufgabe/Name/„zwei Entwickler“/normale Agents, Einzelstart bleibt `start`, Team ansprechen → Leitung); Team-Tools über den echten Bridge von `claude -p` aufgerufen; **Zustellung zwischen laufenden Agents und UI in der App noch nicht getestet**
- [x] Vordefinierte Agents (Vorlagen) — Router mit echtem `claude -p` getestet (7 Fälle: Vorlage de/en, verhörter Name, Modell aus Sprache, laufender Agent wird angesprochen statt neu gestartet), mehrzeilige Richtlinien per node-pty an claude getestet; **UI/Diktat in der App noch nicht getestet**
- [x] Modell per Sprachbefehl („Starte mit Opus einen Agent für …“) — Router-Prompt mit echtem `claude -p` getestet (de/en, „Sonett“, Version), Flag-Zusammenführung getestet; **Agent-Start in der App noch nicht getestet**
- [x] Gemerkte Sprache für schnellere Erkennung — Ablauf mit TTS-Dateien (de/en) per Skript getestet, **in der App noch nicht getestet**
- [x] Spracherkennung im Hintergrund + Auto-Abschicken pro Agent — Build/Lint ok, whisper mit niedriger Priorität getestet (Datei-Test); **Mikrofon/UI noch nicht getestet**
- [x] Automatische `.sln`-Suche beim Projekt-Anlegen — Suche getestet, **in der UI noch nicht getestet**
- [x] Paketierung (`build:unpack`) getestet: entpackt ~338 MB (App selbst ~17 MB, Rest Electron)
- [x] Initialer Git-Commit (nach Durchsicht durch den Nutzer)
- Verteilung an Tester: `npm run build:win` → portable .exe + `LIESMICH.txt` als ZIP (in `dist/`, nicht versioniert)

## Konventionen

- Umgebung: Windows 11, PowerShell / Git Bash
- Vorhanden: Node 23, npm 11, .NET 10, Claude Code 2.1 (`~\.local\bin\claude.exe`), VS Code, Visual Studio 2022 Community (ohne C++-Buildtools)
- Code-Kommentare und UI-Texte auf Deutsch; Prompts/Tool-Beschreibungen für Claude auf Englisch

## Bekannte Stolpersteine

- Pakete in `dist/` werden nicht automatisch neu gebaut → vor dem Testen neuer Funktionen mit der .exe `npm run build:unpack` ausführen (sonst läuft ein alter Stand).
- **Kein Native-Rebuild:** `postinstall` ist nur `install-electron`. `electron-builder install-app-deps` würde node-pty aus dem Quellcode bauen und scheitert ohne C++-Buildtools; die N-API-Prebuilds funktionieren direkt in Electron. Nach fehlgeschlagenem Rebuild: `rm -rf node_modules/node-pty && npm install`.
- Keinen Installer (NSIS o. ä.) wieder einführen: Er würde beim Deinstallieren/Aktualisieren `data\` mitlöschen, und unter „Programme“ fehlen Schreibrechte.
- node-pty muss in `asarUnpack` stehen (DLLs/OpenConsole.exe nicht aus asar ladbar).
- Wird DevHub aus einem Claude-Terminal gestartet, erben Agents sonst `CLAUDE_CODE_CHILD_SESSION` usw. → „Transcript saving is off“ → keine Wiederherstellung. Immer `claudeEnv()` für Claude-Prozesse nutzen.
- Hooks: `curl.exe` mit `.exe` (in PowerShell 5.1 ist `curl` ein Alias). Kein `|| exit 0` (Syntaxfehler in PS 5.1); Fehlercodes ≠ 2 blockieren nicht.
- Monaco 0.57 hat eine Export-Map: Pfade ohne `esm/vs/` (z. B. `monaco-editor/editor/editor.worker?worker`). Voller `monaco-editor`-Import bündelt ~15 MB Sprach-Worker.
- `.cmd`/`.bat` mit Leerzeichen im Pfad: `cmd.exe /d /s /c ""prog" "arg""` + `windowsVerbatimArguments: true` (Node-Standard-Quoting bricht bei `cmd /c`).
- `claude` mit `exec` + Kommando-String aufrufen (nicht `execFile` + `shell: true` → DEP0190). Nur feste Argumente.
- Lint `react-refresh/only-export-components`: Komponenten-Dateien exportieren nur Komponenten → geteilten Zustand/Funktionen nach `lib/` auslagern (z. B. `hotkeyCapture.ts`).
- Lint `react-hooks/set-state-in-effect`: kein synchrones `setState` in `useEffect` — Zustand ableiten (`useMemo`, siehe `selection` in Workspace) oder im `.then()` setzen.
- React StrictMode führt Effekte im Dev-Modus doppelt aus → Seiteneffekte im Main idempotent halten (z. B. `restore()` nur einmal).
- `capturePage` liefert bei verdecktem Fenster ein veraltetes Bild → Fenster vorher `show()/focus()/invalidate()`.
- Heredocs im Bash-Tool verfälschen `\\`, `\r`/`\n` in Strings und Umlaute (Python-stdin) → Code/JSON mit Backslashes oder Umlauten per Edit/Write-Tool schreiben.
- Zeilenenden: überall **LF** (`.gitattributes`: `* text=auto eol=lf`, Prettier erwartet LF). Python `open(..., 'w')` schreibt unter Windows CRLF → Dateien per Edit-Tool ändern (oder `newline=''`, danach `npx prettier --write`). Prüfen: `git ls-files --eol | grep w/crlf`.
- Git: Standard-Branch ist `main`, Remote `origin` = https://github.com/CocoNybbles/DevHub (privat). `gh` ist nicht installiert.
