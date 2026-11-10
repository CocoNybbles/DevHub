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
  3. VS-Code-Ordner: nur konfigurierbar, wenn VS Code installiert ist

**Layout**
- Links: Liste aller Projekte mit ihren Agents
  - Kleiner Button neben dem Projektnamen startet einen neuen Agent
  - Agents heißen standardmäßig „Agent 1“, „Agent 2“, … — Rechtsklick-Menü: Umbenennen, Beenden, Sprachtext abschicken/eintragen (pro Agent)
  - Agents, die eine Frage/Input brauchen, werden hervorgehoben, bis sie weiterarbeiten — links in der Liste und im Raster (gelber Rahmen + Frage im Zellenkopf, `.grid-cell.attention`; aktiv + wartend = gelber Rahmen mit Akzentlinie unter dem Kopf)
  - Agents können über die Liste beendet werden
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

**Start-Prüfung**
- Beim App-Start prüfen, ob Claude Code installiert und eingeloggt ist; ist die Anmeldung abgelaufen, muss der Nutzer sich zuerst neu anmelden

## Tech-Stack

- **Electron + TypeScript** (entschieden 2026-11-10: am stabilsten, einfach zu verteilen)
- Build: electron-vite (Vite 8), Electron 44, electron-builder 26 — nur Windows (NSIS-Installer + portable .exe)
- UI: React 19, reines CSS (`assets/main.css` = Variablen/Basis, `assets/components.css` = Komponenten), Dark Theme
- Terminal: `@xterm/xterm` 6 + `@xterm/addon-fit` (Renderer), `node-pty` 1.1 (Main, ConPTY, N-API-Prebuilds)
- Code-Ansicht: `monaco-editor` 0.57, **schlanker Import** (`monaco-editor/editor/editor.api` + `basic-languages/monaco.contribution` + nur `editor.worker`)
- Sprache → Text: whisper.cpp lokal (Release `b5454`, `whisper-bin-x64.zip`), mehrsprachige quantisierte Modelle, Sprache automatisch (`-l auto`) bzw. gemerkt (s. Architektur)
  - Engine (~9 MB) **und** Modell werden **nicht** mitgeliefert, sondern beim ersten Nutzen nach `%APPDATA%\DevHub\whisper\` geladen
  - Erster Voice-Versuch ohne Modell → `VoiceSetupDialog` (Modellauswahl base ~60 MB / small ~190 MB [Standard] / large-v3-turbo ~550 MB, Download mit Fortschritt direkt im Dialog)
  - Einstellungen: dieselbe Auswahl (`VoiceModels`), Modell wechseln/löschen
- Laufzeit-Abhängigkeiten (`dependencies`) nur: `node-pty`, `@electron-toolkit/utils`. Alles, was Vite bündelt (React, xterm, Monaco), gehört in `devDependencies` (sonst landet es doppelt im Paket).

## Architektur

**Agent-Start** (`main/agents.ts`): `claude.exe` direkt per node-pty im Agent-Ordner (bei `.cmd`-Installation via `cmd.exe /c`, Sonderzeichen werden entfernt):
`claude [Nutzer-Flags]  --session-id <uuid> | --resume <uuid>  --settings <agent>/settings.json  --mcp-config <agent>/mcp.json  --append-system-prompt <Hinweis> [Aufgabe]`
- **Nutzer-Flags** (`shared/agentArgs.ts`): global `settings.agentArgs` + pro Projekt `project.agentArgs`, Text wie in einer Shell (Quotes, Backslashes bleiben). `mergeAgentArgs(global, projekt, agent)`: gleichnamiges Flag einer höheren Ebene ersetzt das niedrigere; Ebene „agent“ = `agent.model` → `--model` (per Sprachbefehl genannt, persistiert, gilt auch bei Wiederherstellung; geprüft mit `isValidModelName`). Stehen **vor** den DevHub-Flags (beendet variadische Werte, Aufgabe bleibt positional). `validateAgentArgs` (Dialoge live + Main beim Speichern) lehnt freien Text und reservierte Flags ab (`--session-id`, `--resume`/`-r`, `--continue`/`-c`, `--fork-session`, `--no-session-persistence`, `--settings`, `--mcp-config`, `--append-system-prompt`, `--print`/`-p`, `--help`, `--version`). Unbekannte Flags prüft erst claude selbst → Startfehler (s. u.).
- `--resume` nur, wenn `~/.claude/projects/*/<sessionId>.jsonl` existiert, sonst `--session-id` (gleiche ID)
- Pro-Agent-Dateien in `%APPDATA%\DevHub\agents\<agentId>\` (bei jedem Start neu geschrieben, da Port/Token wechseln)
- Env ohne Session-Marker einer übergeordneten Claude-Instanz (`claudeEnv()` in `main/tools.ts`)

**Rückkanal Agent → App** (`main/agentBridge.ts`): HTTP-Server auf `127.0.0.1:<zufälliger Port>` mit Zufalls-Token
- `POST /hook/<token>/<agentId>`: Hooks posten ihr JSON per `curl.exe … --data-binary @-`
  Status: `SessionStart`→idle · `UserPromptSubmit`/`PreToolUse`/`PostToolUse`→working · `PreToolUse(AskUserQuestion)`/`Notification`/`Stop`→**needsInput** (links hervorgehoben)
- `POST /mcp/<token>/<agentId>`: minimaler MCP-Server (Streamable HTTP, nur JSON-Antworten) mit Tool `show_code(file_path, start_line, end_line?, note?)` → Event `code:focus` → Monaco rechts. Tool ist per `permissions.allow` freigegeben.

**Agent-Lebenszyklus**
- Namen: kleinste freie Nummer **global** („Agent N“) → eindeutig für Sprachbefehle
- Prozess endet (`/exit` oder ✕ in der Liste) → Agent aus Zustand entfernt, Ansicht schließt sich
- Startfehler: endet ein Agent < 8 s nach Start mit Exit-Code ≠ 0 (nicht per ✕), meldet Main `agents:startFailed` mit den letzten Ausgabezeilen (ohne ANSI) → Toast
- App wird beendet (`before-quit`) → Prozesse gestoppt, Agents bleiben gespeichert → beim nächsten Start `agents:restore` (einmal pro App-Start)

**Terminals im Renderer** (`lib/terminals.ts`): ein xterm pro Agent, lebt unabhängig von React und sammelt Ausgabe auch unsichtbar; `attachTerminal()` hängt das DOM-Element in Einzelansicht oder Rasterzelle. Main hält zusätzlich 200 KB Ausgabe-Puffer (`agents:buffer`) für Renderer-Reloads.

**Sprachsteuerung**: Renderer nimmt WAV auf (`lib/recorder.ts`, 16 kHz mono) → `voice:transcribe` (whisper-cli, Priorität „niedriger als normal“, Threads = halbe Kerne) →
- **Sprache merken** (`settings.voiceRememberLanguage`, Standard an; gemerkt in `settings.voiceLanguage`): zuerst `-l <gemerkt>` (≈1,5 s statt ≈3 s mit `auto`). Auswertung per `-ojf` (JSON: Sprache + Token-Wahrscheinlichkeit `p`). Leeres Ergebnis oder Ø p < 0,6 → zweiter Lauf mit `auto`, dessen Sprache gespeichert wird. Zusätzlich jede 5. Aufnahme `auto`, weil whisper bei erzwungenem `en` andere Sprachen unauffällig ins Englische übersetzt (p bleibt hoch); erzwungenes `de` bei englischer Sprache ergibt dagegen p ≈ 0,5.
- **Hintergrund:** „Fertig“ beendet nur die Aufnahme; Erkennung/Zuordnung laufen als `VoiceJob` weiter (Karten unten in der Mitte, mehrere gleichzeitig), neue Aufnahmen sind sofort möglich. Overlay lässt Klicks durch (`.voice-stack` mit `pointer-events: none`).
- **Abschicken oder nur eintragen:** `agents:sendVoice` entscheidet im Main: `agent.voiceAutoSend` (pro Agent, Rechtsklick-Menü, persistiert) → sonst global `settings.voiceAutoSend`. Gilt auch für globale Befehle (`send`).
- aktiver Agent (Standard `Strg+Shift+Leertaste` / Mikrofon in der Mitte): Text an Agent (`sendLine` = Text, 150 ms, Enter)
- global (Standard `Strg+Alt+Leertaste` per `globalShortcut` / Mikrofon links): `voice:command` → `claude -p --model haiku --output-format json --tools "" --strict-mcp-config --no-session-persistence` (Prompt via stdin) liefert JSON `send` | `start` (+ optional `model`: Alias `fable`/`opus`/`sonnet`/`haiku`, bei genannter Version voller Name wie `claude-opus-5-5`) | `none`
- **Kürzel einstellbar** (Einstellungen → `HotkeyInput`): gespeichert als Electron-Accelerator in `settings.hotkeyAgentVoice` / `hotkeyGlobalVoice`. `shared/hotkeys.ts` übersetzt Tastendrücke (layoutunabhängig über `KeyboardEvent.code`) und formatiert die Anzeige. Main registriert das globale Kürzel neu (`registerGlobalHotkey`; belegt → altes zurück + Fehler im Dialog); während der Aufnahme wird es per `settings:suspendGlobalHotkey` freigegeben. Das Agent-Kürzel lässt das Terminal per `setAppHotkeys()` durch.

**Persistenz** (`main/store.ts`): `%APPDATA%\DevHub\devhub-state.json` (Projekte, laufende Agents, Einstellungen), atomar geschrieben.

## Befehle

| Zweck | Befehl |
|-------|--------|
| Entwicklung (Hot Reload) | `npm run dev` |
| Typprüfung | `npm run typecheck` |
| Lint / Format | `npm run lint` / `npm run format` |
| Build (Typcheck + Bundle nach `out/`) | `npm run build` |
| Entpacktes Paket zum Testen (`dist/win-unpacked/DevHub.exe`) | `npm run build:unpack` |
| Installer + portable .exe nach `dist/` | `npm run build:win` |

**Debug-Umgebungsvariablen**
- `DEVHUB_DEBUG=1`: loggt Agent-Starts, Hook-Ereignisse und MCP-Aufrufe in die Konsole
- `DEVHUB_SCREENSHOT=<pfad.png>` (+ `DEVHUB_SCREENSHOT_DELAY=<ms>`, Standard 8000): speichert ein Fensterbild und loggt den DOM-Zustand (Agent-Zeilen, Code-Notiz)

## Projektstruktur

```
src/
  shared/types.ts          Gemeinsame Typen + DevHubApi
  shared/hotkeys.ts        Kürzel: Standardwerte, Tastendruck → Accelerator, Anzeigeformat
  shared/agentArgs.ts      Start-Flags: Tokenizer, Validierung, Zusammenführen global/Projekt
  main/
    index.ts               Fenster, IPC-Handler, globaler Hotkey, Mikrofon-Berechtigung
    agents.ts              AgentManager: node-pty, Start/Stop/Rename/Restore, Hook-Status, show_code
    agentBridge.ts         Lokaler HTTP-Server: Hooks + MCP (show_code)
    store.ts               JSON-Persistenz, dataDir()
    tools.ts               claude/VS-Code-Erkennung, claudeEnv(), openInVSCode()
    claudeAuth.ts          `claude auth status --json`, Login-Konsole
    voice.ts               whisper.cpp-Download/Transkription, Modellverwaltung
    voiceCommands.ts       Globale Sprachbefehle via `claude -p`
  preload/index.ts         window.api (contextBridge)
  renderer/src/
    App.tsx                Auth-Gate → Workspace; Typ `Selection`
    Workspace.tsx          Zustand, Auswahl, Sprachablauf, Hotkeys, Dialoge
    lib/                   terminals.ts, recorder.ts, errors.ts, hotkeyCapture.ts, selection.ts
    components/            Sidebar, CenterPane, TerminalView, CodePane, ProjectDialog, SettingsDialog,
                           VoiceSetupDialog, VoiceModels, VoiceOverlay, HotkeyInput, AgentArgsHelp, Modal,
                           ContextMenu, AuthGate, Icons
electron-builder.yml       Windows-Ziele, asarUnpack node-pty, nur Sprachen de/en-US
```

**IPC-Muster:** Kanal `bereich:aktion` (z. B. `agents:start`) → Handler in `main/index.ts`, Methode in `preload/index.ts`,
Typ in `DevHubApi` (`shared/types.ts`). Alle drei immer zusammen anpassen. Ereignisse Main→Renderer: `agents:data`,
`agents:changed`, `agents:startFailed`, `code:focus`, `voice:progress`, `voice:globalHotkey` (Abo liefert Abmelde-Funktion).

## Stand

- [x] Login-Prüfung beim Start (blockiert App bis eingeloggt)
- [x] Projekte anlegen/bearbeiten/entfernen (3 Pfade, VS-Code-Pfad nur wenn VS Code installiert), Projektdatei / VS Code öffnen
- [x] Agents starten/umbenennen (Rechtsklick)/beenden, Terminal, Raster-Ansicht, Selbstbeendigung schließt Ansicht
- [x] Input-Erkennung via Hooks, Hervorhebung links — **getestet**
- [x] Code-Ansicht + MCP `show_code` — **Ende-zu-Ende getestet**
- [x] Session-Wiederherstellung — Speichern/Neustart getestet; `--resume` mit echtem Transkript noch **nicht** getestet
- [x] Sprachsteuerung inkl. Download-Dialog — Routing via `claude -p` getestet; **whisper-Download/Transkription + Mikrofon noch nicht getestet**
- [x] Sprach-Kürzel in den Einstellungen änderbar — Build/Typcheck ok, **in der UI noch nicht getestet**
- [x] Start-Flags global + pro Projekt — Parser getestet, claude-Verhalten per PTY geprüft (unbekanntes Flag → Exit 1, `--enable-auto-mode` ist gültig, aber undokumentiert); **in der UI noch nicht getestet**
- [x] Freies Raster per Strg+Klick — Auswahl-Logik per Skript getestet, **in der UI noch nicht getestet**
- [x] Modell per Sprachbefehl („Starte mit Opus einen Agent für …“) — Router-Prompt mit echtem `claude -p` getestet (de/en, „Sonett“, Version), Flag-Zusammenführung getestet; **Agent-Start in der App noch nicht getestet**
- [x] Gemerkte Sprache für schnellere Erkennung — Ablauf mit TTS-Dateien (de/en) per Skript getestet, **in der App noch nicht getestet**
- [x] Spracherkennung im Hintergrund + Auto-Abschicken pro Agent — Build/Lint ok, whisper mit niedriger Priorität getestet (Datei-Test); **Mikrofon/UI noch nicht getestet**
- [x] Automatische `.sln`-Suche beim Projekt-Anlegen — Suche getestet, **in der UI noch nicht getestet**
- [x] Paketierung (`build:unpack`) getestet: entpackt ~338 MB (App selbst ~17 MB, Rest Electron)
- [x] Initialer Git-Commit (nach Durchsicht durch den Nutzer)
- Verteilung an Tester: `npx electron-builder --win portable` → portable .exe + `LIESMICH.txt` als ZIP (in `dist/`, nicht versioniert)

## Konventionen

- Umgebung: Windows 11, PowerShell / Git Bash
- Vorhanden: Node 23, npm 11, .NET 10, Claude Code 2.1 (`~\.local\bin\claude.exe`), VS Code, Visual Studio 2022 Community (ohne C++-Buildtools)
- Code-Kommentare und UI-Texte auf Deutsch; Prompts/Tool-Beschreibungen für Claude auf Englisch

## Bekannte Stolpersteine

- **Kein Native-Rebuild:** `postinstall` ist nur `install-electron`. `electron-builder install-app-deps` würde node-pty aus dem Quellcode bauen und scheitert ohne C++-Buildtools; die N-API-Prebuilds funktionieren direkt in Electron. Nach fehlgeschlagenem Rebuild: `rm -rf node_modules/node-pty && npm install`.
- node-pty muss in `asarUnpack` stehen (DLLs/OpenConsole.exe nicht aus asar ladbar).
- Wird DevHub aus einem Claude-Terminal gestartet, erben Agents sonst `CLAUDE_CODE_CHILD_SESSION` usw. → „Transcript saving is off“ → keine Wiederherstellung. Immer `claudeEnv()` für Claude-Prozesse nutzen.
- Hooks: `curl.exe` mit `.exe` (in PowerShell 5.1 ist `curl` ein Alias). Kein `|| exit 0` (Syntaxfehler in PS 5.1); Fehlercodes ≠ 2 blockieren nicht.
- Monaco 0.57 hat eine Export-Map: Pfade ohne `esm/vs/` (z. B. `monaco-editor/editor/editor.worker?worker`). Voller `monaco-editor`-Import bündelt ~15 MB Sprach-Worker.
- `claude` mit `exec` + Kommando-String aufrufen (nicht `execFile` + `shell: true` → DEP0190). Nur feste Argumente.
- Lint `react-refresh/only-export-components`: Komponenten-Dateien exportieren nur Komponenten → geteilten Zustand/Funktionen nach `lib/` auslagern (z. B. `hotkeyCapture.ts`).
- Lint `react-hooks/set-state-in-effect`: kein synchrones `setState` in `useEffect` — Zustand ableiten (`useMemo`, siehe `selection` in Workspace) oder im `.then()` setzen.
- React StrictMode führt Effekte im Dev-Modus doppelt aus → Seiteneffekte im Main idempotent halten (z. B. `restore()` nur einmal).
- `capturePage` liefert bei verdecktem Fenster ein veraltetes Bild → Fenster vorher `show()/focus()/invalidate()`.
- Heredocs im Bash-Tool verfälschen `\\`, `\r`/`\n` in Strings und Umlaute (Python-stdin) → Code/JSON mit Backslashes oder Umlauten per Edit/Write-Tool schreiben.
- Zeilenenden: überall **LF** (`.gitattributes`: `* text=auto eol=lf`, Prettier erwartet LF). Python `open(..., 'w')` schreibt unter Windows CRLF → Dateien per Edit-Tool ändern (oder `newline=''`, danach `npx prettier --write`). Prüfen: `git ls-files --eol | grep w/crlf`.
- Git: Standard-Branch ist `main`, Remote `origin` = https://github.com/CocoNybbles/DevHub (privat). `gh` ist nicht installiert.
