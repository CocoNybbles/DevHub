# DevHub

Windows-App zum Verwalten von Projekten und den darin laufenden KI-Coding-Agents (Claude Code): Terminals pro Agent, Raster-Ansicht, Dateivorschau mit hervorgehobenen Änderungen, Sprachsteuerung und Teams mit Orchestrator.

**[Neueste Version herunterladen](https://github.com/CocoNybbles/DevHub/releases/latest)** – Änderungen stehen bei den einzelnen [Releases](https://github.com/CocoNybbles/DevHub/releases).

## Installation

1. ZIP herunterladen und in einen beschreibbaren Ordner entpacken (z. B. `C:\Tools\DevHub`, nicht unter „Programme“).
2. `DevHub.exe` starten – keine Installation nötig. Meldet Windows „Der Computer wurde durch Windows geschützt“ (die Datei ist nicht signiert): „Weitere Informationen“ → „Trotzdem ausführen“.

**Voraussetzungen:** Windows 10/11 (64 Bit) und [Claude Code](https://claude.com/claude-code), installiert und angemeldet. Optional: Mikrofon für die Sprachsteuerung.

**Update:** neue Version über den alten Ordner entpacken – Daten und Einstellungen im Ordner `data` bleiben erhalten. Zum Deinstallieren den Ordner löschen.

## Funktionen

- **Projekte:** Agent-Ordner, Projektdatei (`.sln` wird automatisch gesucht) und Ordner je Projekt; mehrere Projekte auf einmal importieren; Öffnen mit frei wählbaren Programmen
- **Agents:** beliebig viele Claude-Code-Agents pro Projekt mit eigenem Terminal, Raster-Ansicht, Hervorhebung wartender Agents, Wiederherstellung nach Neustart, Anweisungen im eigenen Tab (Strg+G) mit Diktat und Bildern, vordefinierte Agents mit Rolle und Modell
- **Code-Ansicht:** bearbeitete Dateien als Reiter mit hervorgehobenen Änderungen, vom Agent gezeigte Code-Stellen, Snippets mit Kopier-Button
- **Teams:** mehrere Agents mit automatisch gestartetem Orchestrator, der die Aufgabe verteilt und über Freigaben entscheidet; die Mitglieder lassen sich beobachten
- **Sprachsteuerung:** Anweisung an den aktiven Agent oder systemweiter Sprachbefehl („Agent 2, schreib Tests für den Login“, „Starte einen Agent für …“); Spracherkennung lokal per whisper.cpp

## Entwicklung

Electron + TypeScript + React (electron-vite). Node 22+ und npm.

```sh
npm install
npm run dev        # Entwicklung mit Hot Reload
npm run build:win  # ZIP nach dist/
```

Details zu Architektur, Konventionen und Stolpersteinen: [CLAUDE.md](CLAUDE.md).
