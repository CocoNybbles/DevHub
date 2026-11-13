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
- **Eingang:** alles, was auf dich wartet, an einer Stelle – wartende Agents mit Direktantwort, Freigaben (auch „immer erlauben“ je Projekt), Hinweise der Agents, Warnung bei gleichzeitig bearbeiteten Dateien; Windows-Benachrichtigung, wenn DevHub im Hintergrund ist
- **Worktrees und Review:** auf Wunsch arbeitet jeder Agent in einem eigenen Git-Worktree; Änderungen im Vergleich prüfen, einzeln zurücknehmen, committen, zusammenführen und Kommentare an den Agent schicken
- **Prüfungen:** Befehle wie Typcheck, Lint oder Tests laufen automatisch, wenn ein Agent fertig meldet – bei Fehlern bessert er nach
- **Aufträge und Aufgaben:** Anweisungen einreihen („wenn fertig, dann …“), Aufgaben-Board je Projekt, Prompt-Bibliothek mit Platzhaltern
- **Überblick:** aktueller Schritt und Fortschritt je Agent, Kontextgröße und Token-Verbrauch, Verlauf beendeter Sitzungen (fortsetzen, abzweigen, durchsuchen), Tagesbericht
- **Ausführen:** Dev-Server, Tests und andere Projekt-Befehle mit Live-Ausgabe, die auch die Agents lesen können; Web-Vorschau mit Screenshot an den Agent
- **Außerdem:** andere Coding-Agents als Terminal-Programm (eingeschränkt), Fernzugriff im eigenen Netz fürs Handy (abschaltbar, Standard aus)
- **Sprachsteuerung:** Anweisung an den aktiven Agent oder systemweiter Sprachbefehl („Agent 2, schreib Tests für den Login“, „Starte einen Agent für …“); Spracherkennung lokal per whisper.cpp

## Entwicklung

Electron + TypeScript + React (electron-vite). Node 22+ und npm.

```sh
npm install
npm run dev        # Entwicklung mit Hot Reload
npm run build:win  # ZIP nach dist/
```

Details zu Architektur, Konventionen und Stolpersteinen: [CLAUDE.md](CLAUDE.md).

## Lizenz

[MIT](LICENSE). Die enthaltenen Open-Source-Bibliotheken und ihre Lizenzen stehen in `THIRD_PARTY_NOTICES.txt` im Programmordner (wird beim Build erzeugt).

Claude Code ist nicht enthalten: DevHub startet das lokal installierte `claude`, für das die Nutzungsbedingungen von Anthropic gelten.
