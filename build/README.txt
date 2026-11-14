DevHub – test version
=====================

(Deutsche Fassung weiter unten / German version below)

Requirements
------------
- Windows 10/11 (64-bit)
- Claude Code installed and signed in
  (https://claude.com/claude-code – after installing, run "claude" once in a terminal and sign in)
- Optional: Visual Studio / VS Code for opening the projects
- Optional: a microphone for voice control

Start
-----
Extract the ZIP to a writable folder (e.g. C:\Tools\DevHub, not under "Program Files")
and run DevHub.exe – no installation needed.
On the first start Windows may show "Windows protected your PC"
(the file is not signed): "More info" -> "Run anyway".

Language
--------
The interface follows the Windows language (English or German).
You can change it under Settings (gear icon) -> Language.

First steps
-----------
1. "+" at the top left -> add a project, or "Import" next to it for several projects at once
2. Play button next to the project -> a new agent starts in the terminal
3. Right-click an agent -> rename; X -> stop
4. Click the project -> all its agents in a grid
5. When an agent finds a relevant piece of code, it is shown highlighted on the right
6. Voice control (microphone buttons / Ctrl+Shift+Space or Ctrl+Alt+Space):
   the first time, a speech model is downloaded (choose one in the dialog)
   Shortcuts can be changed under Settings (gear icon)

Good to know
------------
- Agents that are running when you close the app are restored on the next start
- Data/settings are stored in the "data" folder next to DevHub.exe
  (to reset, delete "data"; to uninstall, delete the whole folder)
- Update: extract the new version over the old folder, "data" is kept

Please test in particular
-------------------------
- Voice control: model download, recording, recognition (German/English)
- Restore: close the app with a running agent (that has already done something) and start it again
- System-wide shortcut Ctrl+Alt+Space while DevHub is in the background


==============================================================================
DEUTSCH
==============================================================================

DevHub – Testversion
====================

Voraussetzungen
---------------
- Windows 10/11 (64 Bit)
- Claude Code installiert und angemeldet
  (https://claude.com/claude-code – nach der Installation einmal "claude" im Terminal starten und anmelden)
- Optional: Visual Studio / VS Code zum Öffnen der Projekte
- Optional: Mikrofon für die Sprachsteuerung

Start
-----
ZIP in einen beschreibbaren Ordner entpacken (z. B. C:\Tools\DevHub, nicht unter "Programme")
und DevHub.exe starten – keine Installation nötig.
Windows zeigt beim ersten Start evtl. "Der Computer wurde durch Windows geschützt"
(die Datei ist nicht signiert): "Weitere Informationen" -> "Trotzdem ausführen".

Sprache
-------
Die Oberfläche richtet sich nach der Windows-Sprache (Deutsch oder Englisch).
Ändern unter Einstellungen (Zahnrad) -> Sprache.

Erste Schritte
--------------
1. Links oben "+" -> Projekt anlegen, oder daneben "Importieren" für mehrere Projekte auf einmal
2. Play-Button neben dem Projekt -> neuer Agent startet im Terminal
3. Rechtsklick auf einen Agent -> umbenennen; X -> beenden
4. Klick auf das Projekt -> alle Agents im Raster
5. Findet ein Agent eine relevante Code-Stelle, erscheint sie rechts hervorgehoben
6. Sprachsteuerung (Mikrofon-Buttons / Strg+Shift+Leertaste bzw. Strg+Alt+Leertaste):
   beim ersten Mal wird ein Sprachmodell heruntergeladen (Auswahl im Dialog)
   Kürzel lassen sich unter Einstellungen (Zahnrad) ändern

Gut zu wissen
-------------
- Beim Schließen laufende Agents werden beim nächsten Start wiederhergestellt
- Daten/Einstellungen liegen im Ordner "data" neben DevHub.exe
  (zum Zurücksetzen "data" löschen, zum Deinstallieren den ganzen Ordner)
- Update: neue Version über den alten Ordner entpacken, "data" bleibt erhalten

Bitte besonders testen
----------------------
- Sprachsteuerung: Modell-Download, Aufnahme, Erkennung (Deutsch/Englisch)
- Wiederherstellung: App mit laufendem Agent (der schon etwas gemacht hat) schließen und neu starten
- Systemweites Kürzel Strg+Alt+Leertaste, während DevHub im Hintergrund ist
