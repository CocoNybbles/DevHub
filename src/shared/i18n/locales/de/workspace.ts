import type en from '../en/workspace'

/** German texts: namespace `workspace` */
const de: typeof en = {
  // Agents
  startFailed: '{name} konnte nicht starten',
  startFailedWithOutput: '{name} konnte nicht starten:\n{output}',
  confirmStopTeam_one: 'Team „{name}“ mit {count} Agent(s) beenden?',
  confirmStopTeam_other: 'Team „{name}“ mit {count} Agent(s) beenden?',
  confirmStopOrchestrator: '„{name}“ steuert ein Team – das ganze Team beenden?',
  confirmStopAgent: '„{name}“ beenden?',
  confirmRemoveProject: 'Projekt „{name}“ entfernen? (Die Dateien bleiben unverändert.)',
  confirmRemoveProjectRunning_one:
    'Projekt „{name}“ entfernen? {count} laufende Agent(s) werden beendet.',
  confirmRemoveProjectRunning_other:
    'Projekt „{name}“ entfernen? {count} laufende Agent(s) werden beendet.',
  noActiveAgent: 'Kein aktiver Agent ausgewählt.',
  workerNoOrchestrator: '{name} kann nur beobachtet werden – kein Orchestrator läuft.',
  workerObserveOnly: '{name} kann nur beobachtet werden – Anweisungen gehen an den Orchestrator.',
  createProjectFirst: 'Lege zuerst ein Projekt an.',
  projectsImported_one: '{count} Projekt(e) importiert.',
  projectsImported_other: '{count} Projekt(e) importiert.',

  // Editor tabs in the center
  editorNotOpened:
    '{name} hat den Editor nicht geöffnet – evtl. ist im Terminal gerade eine Auswahl offen.',
  editorTabTooltip: 'Anweisung für {name} – der Agent ist gesperrt, bis der Tab geschlossen wird',
  editorTabCloseTooltip: 'Schließen – Text in den Prompt übernehmen, ohne abzuschicken',

  // Voice control
  voiceCommandTarget: 'Sprachbefehl',
  voiceErrorTarget: 'Sprache',
  voiceTranscribing: 'Wandle in Text um …',
  voiceDetecting: 'Erkenne Sprache und Text …',
  voiceTooShort: 'Aufnahme zu kurz.',
  voiceNothingUnderstood: 'Nichts verstanden.',
  voiceSent: '→ gesendet',
  voiceEntered: '→ eingetragen',
  voiceRouting: 'Claude ordnet den Befehl zu …',
  voiceSentTo: '→ an {agent} gesendet',
  voiceEnteredFor: '→ an {agent} eingetragen',
  voiceTeamStarted: 'Team „{team}“ in „{project}“ gestartet: {agents}',
  voiceTeamStartedWithTask: 'Team „{team}“ in „{project}“ gestartet: {agents} (mit Aufgabe)',
  voiceTempTeamStarted: 'Temporäres Team „{team}“ in „{project}“ gestartet: {agents}',
  voiceTempTeamStartedWithTask:
    'Temporäres Team „{team}“ in „{project}“ gestartet: {agents} (mit Aufgabe)',
  voiceAgentStarted: '{agent} in „{project}“ gestartet',
  voiceAgentStartedWithTask: '{agent} in „{project}“ gestartet mit Aufgabe',
  voiceAgentStartedWithModel: '{agent} in „{project}“ gestartet (Modell {model})',
  voiceAgentStartedWithModelAndTask:
    '{agent} in „{project}“ gestartet (Modell {model}) mit Aufgabe',
  voiceInstructionFor: 'Anweisung an {name}',
  voiceInstructionAbout: 'Anweisung an {name} (zu {worker})',
  voiceGlobalExample:
    'z. B. „Agent 2, schreib Tests für den Login“ oder „Starte einen Agent für DevHub …“',
  micUnavailable: 'Mikrofon nicht verfügbar: {error}',
  voiceReady: 'Sprachsteuerung ist bereit.',
  voiceRecording: 'Aufnahme',
  voiceQuoted: '„{text}“'
}

export default de
