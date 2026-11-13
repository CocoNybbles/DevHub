# Sicherheit

## Sicherheitslücke melden

Bitte **kein öffentliches Issue** anlegen. Melde Sicherheitslücken vertraulich über
[„Report a vulnerability“](https://github.com/CocoNybbles/DevHub/security/advisories/new)
(Reiter „Security“ im Repository).

Hilfreich sind:

- betroffene Version (siehe [Releases](https://github.com/CocoNybbles/DevHub/releases))
- Beschreibung und Auswirkung der Lücke
- Schritte zum Nachvollziehen

Du bekommst eine Rückmeldung, sobald die Meldung geprüft ist. Behobene Lücken werden mit einem
neuen Release ausgeliefert.

## Unterstützte Versionen

Sicherheitskorrekturen gibt es nur für die jeweils [neueste Version](https://github.com/CocoNybbles/DevHub/releases/latest).

## Hinweise

- DevHub startet das lokal installierte Claude Code mit den Rechten des angemeldeten Windows-Benutzers.
  Agents können in ihrem Projektordner Dateien ändern und Befehle ausführen – so wie Claude Code selbst.
- Der Rückkanal der Agents zur App lauscht nur auf `127.0.0.1` und ist mit einem zufälligen Token geschützt.
