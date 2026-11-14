/** English texts (reference): namespace `sidebar` */
const en = {
  // Agent status (tooltip of an agent row)
  statusStarting: 'Starting …',
  statusWorking: 'Working',
  statusIdle: 'Ready',
  statusNeedsInput: 'Waiting for input',

  // Start menu
  startAgent: 'Start agent',
  startNamed: 'Start {name}',
  startNamedWithModel: 'Start {name} ({model})',
  startTeam: 'Start team {name} ({members})',
  moreEngines: 'More engines',
  startChoiceTooltip: 'Start: agent, predefined agent or team',
  startNewAgent: 'Start new agent',

  // Agent row
  workerHint:
    'Team member – watch only; instructions go to the orchestrator\nCtrl+click: add to/remove from the grid\nDrag: change the order',
  agentHint:
    'Ctrl+click: add to/remove from the grid\nDrag: change the order\nRight-click: rename, voice setting',
  tooltipWorktree: 'Worktree: {branch}',
  tooltipQueue_one: '{count} instruction in the queue',
  tooltipQueue_other: '{count} instructions in the queue',
  tooltipModel: 'Model: {model}',
  tooltipOrchestrator: 'Orchestrator: runs the team, your only point of contact',
  tooltipLead: 'Leads the team',
  leadTag: 'Lead',
  watchOnly: 'Watch only',
  editingTag: 'Tab',
  editingTagTooltip: 'The instruction is being written in the editor tab – click to switch there',
  worktreeTag: 'wt',
  worktreeTagTooltip: 'Own worktree: {branch}',
  queueTagTooltip: 'Instructions in the queue',
  toEditorTab: 'Go to editor tab',
  editPromptTooltip: 'Write the instruction in a tab – with images and dictation ({hotkey})',
  voiceToAgent: 'Voice instruction to {name}',
  clearConversation: 'Clear the conversation of {name} (/clear)',
  stopTeamTooltip: 'Stop team (orchestrator and all members)',
  stopAgentTooltip: 'Stop agent',

  // Agent context menu
  menuWriteInTab: 'Write instruction in a tab ({hotkey})',
  menuQueueMore: 'Add instruction … ({count} waiting)',
  menuQueue: 'Instruction / prompt from the library …',
  menuReview: 'Review changes …',
  menuFork: 'Fork conversation',
  menuStopTeam: 'Stop team',
  menuStop: 'Stop',
  menuVoiceHeading: 'Voice instructions',
  menuVoiceGlobalSend: 'Same as global (send)',
  menuVoiceGlobalInsert: 'Same as global (insert only)',
  menuVoiceAutoSend: 'Send automatically',
  menuVoiceInsertOnly: 'Only insert into the terminal',

  // Team
  menuShowInGrid: 'Show in grid',
  menuSortMembers: 'Sort members by name',
  teamTitle: 'Team “{name}”',
  teamTitleTemporary: 'Temporary team “{name}”',
  teamOrchestratorLine:
    'Orchestrator: {name} – directs the members and is the only one you talk to; you can watch the members',
  teamLeadLine: 'Lead: {name}',
  teamClickHint: 'Click: all in the grid · Ctrl+click: add/remove · Right-click: stop',
  temporaryTag: 'temporary',
  agentWaiting: 'An agent is waiting',

  // Header
  globalVoiceTooltip: 'Voice command: address an agent/team by name or start a new one ({hotkey})',
  sortProjects: 'Sort projects alphanumerically (ascending)',
  addProject: 'Add project',
  importProjects:
    'Import projects: scan folders (e.g. your whole dev folder, several with Ctrl+click)',
  noProjects: 'No projects registered yet.',

  // Project row
  menuTasks: 'Tasks …',
  menuRun: 'Run / preview …',
  menuSortAgents: 'Sort agents by name',
  menuEdit: 'Edit …',
  projectHint: 'Ctrl+click: add all agents to/remove them from the grid\nDrag: change the order',
  openProjectFile: 'Open project file: {file}\nwith {program}',
  openFolder: 'Open folder: {folder}\nwith {program}',
  windowsDefaultProgram: 'Windows default program',
  windowsExplorer: 'Windows Explorer',

  // Footer
  tasksTooltip: 'Task board: collect tasks, start agents with them or queue them for an agent',
  history: 'History',
  historyTooltip: 'Resume finished sessions, search all conversations, usage',
  report: 'Report',
  reportTooltip: 'Daily report: what did the agents do today, what is still open?'
}

export default en
