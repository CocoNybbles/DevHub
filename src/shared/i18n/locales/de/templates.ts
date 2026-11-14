import type en from '../en/templates'

/** German texts: namespace `templates` */
const de: typeof en = {
  // Predefined agent
  invalidModelName: 'Ungültiger Modellname',
  agentTitleEdit: 'Vordefinierter Agent: {name}',
  agentTitleNew: 'Neuer vordefinierter Agent',
  agentNameHelp:
    'So heißt der Agent beim Start (weitere: „{name} 2“ …) und so sprichst du ihn per Sprache an, z. B. „Starte einen {example} für DevHub“.',
  agentNameExample: 'Entwickler',
  agentNamePlaceholder: 'z. B. Entwickler, Reviewer, Tester',
  modelHelp:
    'Leer = wie in den Start-Flags. Nennst du beim Sprachbefehl ein Modell, hat das Vorrang.',
  modelPlaceholder: 'z. B. opus, sonnet oder claude-opus-5-5',
  roleLabel: 'Rolle und Richtlinien',
  roleHelp:
    'Wird dem Agent bei jedem Start als Anweisung mitgegeben, z. B. wie er arbeiten, testen und committen soll. Mit dem Mikrofon diktieren.',
  rolePlaceholder:
    'z. B. Du bist ein erfahrener Entwickler. Schreibe zu jeder Änderung Tests, halte dich an die Konventionen in CLAUDE.md und erkläre kurz, was du geändert hast.',

  // Team
  teamTitleEdit: 'Team: {name}',
  teamTitleNew: 'Neues Team',
  teamNameHelp: 'Per Sprache startbar, z. B. „Starte das Team {name} für DevHub“.',
  teamNameExample: 'Feature',
  teamNamePlaceholder: 'z. B. Feature, Bugfix, Review',
  membersLabel: 'Mitglieder',
  membersHelp:
    'Zusätzlich startet automatisch ein Orchestrator: Er bekommt die Aufgabe, verteilt sie an die Mitglieder, entscheidet über ihre Freigaben und berichtet dir. Die Mitglieder kannst du nur beobachten.',
  normalAgent: 'Normaler Agent',
  addMember: '+ Mitglied',
  noTemplatesTip:
    'Tipp: Lege zuerst vordefinierte Agents (z. B. Entwickler, Reviewer) an, um ihnen Rollen zu geben.',
  sharedGuidelinesLabel: 'Gemeinsame Richtlinien',
  sharedGuidelinesHelp:
    'Gilt für alle Mitglieder zusätzlich zu ihren eigenen Richtlinien, z. B. Ablauf und Übergaben. Mit dem Mikrofon diktieren.',
  sharedGuidelinesPlaceholder:
    'z. B. Der Entwickler setzt um und übergibt dann an den Reviewer. Der Reviewer prüft und meldet Befunde zurück, bis alles passt. Erst dann wird committet.'
}

export default de
