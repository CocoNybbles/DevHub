/** English texts (reference): namespace `workspace` */
const en = {
  // Agents
  startFailed: '{name} could not start',
  startFailedWithOutput: '{name} could not start:\n{output}',
  confirmStopTeam_one: 'Stop team “{name}” with {count} agent?',
  confirmStopTeam_other: 'Stop team “{name}” with {count} agents?',
  confirmStopOrchestrator: '“{name}” runs a team – stop the whole team?',
  confirmStopAgent: 'Stop “{name}”?',
  confirmRemoveProject: 'Remove project “{name}”? (The files stay untouched.)',
  confirmRemoveProjectRunning_one:
    'Remove project “{name}”? {count} running agent will be stopped.',
  confirmRemoveProjectRunning_other:
    'Remove project “{name}”? {count} running agents will be stopped.',
  noActiveAgent: 'No active agent selected.',
  workerNoOrchestrator: '{name} can only be observed – no orchestrator is running.',
  workerObserveOnly: '{name} can only be observed – instructions go to the orchestrator.',
  createProjectFirst: 'Create a project first.',
  projectsImported_one: '{count} project imported.',
  projectsImported_other: '{count} projects imported.',

  // Editor tabs in the center
  editorNotOpened:
    '{name} did not open the editor – there may be a selection open in the terminal right now.',
  editorTabTooltip: 'Instruction for {name} – the agent is locked until the tab is closed',
  editorTabCloseTooltip: 'Close – put the text into the prompt without sending it',

  // Voice control
  voiceCommandTarget: 'Voice command',
  voiceErrorTarget: 'Voice',
  voiceTranscribing: 'Transcribing …',
  voiceDetecting: 'Detecting language and text …',
  voiceTooShort: 'Recording too short.',
  voiceNothingUnderstood: 'Nothing understood.',
  voiceSent: '→ sent',
  voiceEntered: '→ entered',
  voiceRouting: 'Claude is routing the command …',
  voiceSentTo: '→ sent to {agent}',
  voiceEnteredFor: '→ entered for {agent}',
  voiceTeamStarted: 'Team “{team}” started in “{project}”: {agents}',
  voiceTeamStartedWithTask: 'Team “{team}” started in “{project}”: {agents} (with task)',
  voiceTempTeamStarted: 'Temporary team “{team}” started in “{project}”: {agents}',
  voiceTempTeamStartedWithTask:
    'Temporary team “{team}” started in “{project}”: {agents} (with task)',
  voiceAgentStarted: '{agent} started in “{project}”',
  voiceAgentStartedWithTask: '{agent} started in “{project}” with task',
  voiceAgentStartedWithModel: '{agent} started in “{project}” (model {model})',
  voiceAgentStartedWithModelAndTask: '{agent} started in “{project}” (model {model}) with task',
  voiceInstructionFor: 'Instruction for {name}',
  voiceInstructionAbout: 'Instruction for {name} (about {worker})',
  voiceGlobalExample: 'e.g. “Agent 2, write tests for the login” or “Start an agent for DevHub …”',
  micUnavailable: 'Microphone not available: {error}',
  voiceReady: 'Voice control is ready.',
  voiceRecording: 'Recording',
  voiceQuoted: '“{text}”'
}

export default en
