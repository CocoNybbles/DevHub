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
  2. Projektdatei: `.sln` / Projektdatei, öffnbar z. B. mit Visual Studio
  3. VS-Code-Ordner: nur konfigurierbar, wenn VS Code installiert ist

**Layout**
- Links: Liste aller Projekte mit ihren Agents
  - Kleiner Button neben dem Projektnamen startet einen neuen Agent
  - Agents heißen standardmäßig „Agent 1“, „Agent 2“, … — Umbenennen per Rechtsklick
  - Agents, die eine Frage/Input brauchen, werden hervorgehoben, bis sie weiterarbeiten
  - Agents können über die Liste beendet werden
- Mitte: Terminal (PowerShell) des ausgewählten Agents
  - Klick auf ein Projekt → alle Agents des Projekts im Raster
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
- Sprache → Text: whisper.cpp lokal (Release `b5454`, `whisper-bin-x64.zip`), mehrsprachige quantisierte Modelle, Sprache automatisch (`-l auto`)
  - Engine (~9 MB) **und** Modell werden **nicht** mitgeliefert, sondern beim ersten Nutzen nach `%APPDATA%\DevHub\whisper\` geladen
  - Erster Voice-Versuch ohne Modell → `VoiceSetupDialog` (Modellauswahl base ~60 MB / small ~190 MB [Standard] / large-v3-turbo ~550 MB, Download mit Fortschritt direkt im Dialog)
  - Einstellungen: dieselbe Auswahl (`VoiceModels`), Modell wechseln/löschen
- Laufzeit-Abhängigkeiten (`dependencies`) nur: `node-pty`, `@electron-toolkit/utils`. Alles, was Vite bündelt (React, xterm, Monaco), gehört in `devDependencies` (sonst landet es doppelt im Paket).

## Architektur

**Agent-Start** (`main/agents.ts`): `claude.exe` direkt per node-pty im Agent-Ordner (bei `.cmd`-Installation via `cmd.exe /c`, Sonderzeichen werden entfernt):
`claude --session-id <uuid> | --resume <uuid>  --settings <agent>/settings.json  --mcp-config <agent>/mcp.json  --append-system-prompt <Hinweis> [Aufgabe]`
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
- App wird beendet (`before-quit`) → Prozesse gestoppt, Agents bleiben gespeichert → beim nächsten Start `agents:restore` (einmal pro App-Start)

**Terminals im Renderer** (`lib/terminals.ts`): ein xterm pro Agent, lebt unabhängig von React und sammelt Ausgabe auch unsichtbar; `attachTerminal()` hängt das DOM-Element in Einzelansicht oder Rasterzelle. Main hält zusätzlich 200 KB Ausgabe-Puffer (`agents:buffer`) für Renderer-Reloads.

**Sprachsteuerung**: Renderer nimmt WAV auf (`lib/recorder.ts`, 16 kHz mono) → `voice:transcribe` (whisper-cli) →
- aktiver Agent (Standard `Strg+Shift+Leertaste` / Mikrofon in der Mitte): Text an Agent (`sendLine` = Text, 150 ms, Enter; oder nur eintragen, Einstellung `voiceAutoSend`)
- global (Standard `Strg+Alt+Leertaste` per `globalShortcut` / Mikrofon links): `voice:command` → `claude -p --model haiku --output-format json --tools "" --strict-mcp-config --no-session-persistence` (Prompt via stdin) liefert JSON `send` | `start` | `none`
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
    lib/                   terminals.ts, recorder.ts, errors.ts, hotkeyCapture.ts
    components/            Sidebar, CenterPane, TerminalView, CodePane, ProjectDialog, SettingsDialog,
                           VoiceSetupDialog, VoiceModels, VoiceOverlay, HotkeyInput, Modal, ContextMenu,
                           AuthGate, Icons
electron-builder.yml       Windows-Ziele, asarUnpack node-pty, nur Sprachen de/en-US
```

**IPC-Muster:** Kanal `bereich:aktion` (z. B. `agents:start`) → Handler in `main/index.ts`, Methode in `preload/index.ts`,
Typ in `DevHubApi` (`shared/types.ts`). Alle drei immer zusammen anpassen. Ereignisse Main→Renderer: `agents:data`,
`agents:changed`, `code:focus`, `voice:progress`, `voice:globalHotkey` (Abo liefert Abmelde-Funktion).

## Stand

- [x] Login-Prüfung beim Start (blockiert App bis eingeloggt)
- [x] Projekte anlegen/bearbeiten/entfernen (3 Pfade, VS-Code-Pfad nur wenn VS Code installiert), Projektdatei / VS Code öffnen
- [x] Agents starten/umbenennen (Rechtsklick)/beenden, Terminal, Raster-Ansicht, Selbstbeendigung schließt Ansicht
- [x] Input-Erkennung via Hooks, Hervorhebung links — **getestet**
- [x] Code-Ansicht + MCP `show_code` — **Ende-zu-Ende getestet**
- [x] Session-Wiederherstellung — Speichern/Neustart getestet; `--resume` mit echtem Transkript noch **nicht** getestet
- [x] Sprachsteuerung inkl. Download-Dialog — Routing via `claude -p` getestet; **whisper-Download/Transkription + Mikrofon noch nicht getestet**
- [x] Sprach-Kürzel in den Einstellungen änderbar — Build/Typcheck ok, **in der UI noch nicht getestet**
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
- Heredocs mit `\\` im Bash-Tool werden verfälscht → JSON mit Windows-Pfaden per Write-Tool schreiben.
- Zeilenenden: überall **LF** (`.gitattributes`: `* text=auto eol=lf`, Prettier erwartet LF). Python `open(..., 'w')` schreibt unter Windows CRLF → Dateien per Edit-Tool ändern (oder `newline=''`, danach `npx prettier --write`). Prüfen: `git ls-files --eol | grep w/crlf`.
- Git: Standard-Branch ist `main`, Remote `origin` = https://github.com/CocoNybbles/DevHub (privat). `gh` ist nicht installiert.
