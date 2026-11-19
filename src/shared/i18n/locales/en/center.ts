/** English texts (reference): namespace `center` */
const en = {
  // Single view header
  worktreeTooltip: 'Own worktree: {path}',
  contextTooltip: 'Tokens in the context of the conversation (as of the last reply)',
  contextSize: 'Context {tokens}',
  editPromptTooltip: 'Write the instruction in a tab – with images and dictation ({hotkey})',

  // Grid
  agentCount_one: '{count} agent',
  agentCount_other: '{count} agents',
  projectCount_one: '{count} project',
  projectCount_other: '{count} projects',
  gridHint: 'Ctrl+click on the left changes the selection',
  voiceToActive: 'Voice instruction to the active agent ({hotkey})',
  cellHeaderTooltip: 'Double-click: single view',
  waitingForInput: 'Waiting for input',

  // Project view
  startNewAgent: 'Start new agent',
  noAgents: 'No agents in this project.',
  startAgent: 'Start agent',

  // Nothing selected
  terminal: 'Terminal',
  emptySelect: 'Select a project or an agent on the left.',
  emptyProjectHint: 'Clicking a project shows all its agents in a grid.',
  emptyGridHint: 'Ctrl+click on agents/projects builds a grid of your own.',

  // Agent locked while its editor tab is open
  lockedTooltip: '{name} is locked – click to switch to the editor tab',
  lockedNotice: 'Input locked – the instruction is being written in the tab',
  toTab: 'Go to tab',
  lockedBadge: 'in tab',
  lockedBadgeTooltip: 'Locked until the editor tab is closed – click to switch there',

  // Agent buttons
  watchTooltip: 'Team member – watch only. Instructions go to the orchestrator.',
  watchTooltipNamed: 'Team member – watch only. Instructions go to {name}.',
  watching: 'watching',
  voiceToAgent: 'Voice instruction to {name}',
  clearConversation: 'Clear the conversation of {name} (/clear)',
  stopTeamTooltip: 'Stop team (orchestrator and all members)',
  stopAgentTooltip: 'Stop agent'
}

export default en
