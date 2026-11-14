/** English texts (reference): namespace `agents` */
const en = {
  // Errors (shown as toasts)
  agentNotRunningAnymore: 'The agent is no longer running',
  agentNotRunning: 'The agent is not running',
  projectNotFound: 'Project not found',
  teamTemplateNotFound: 'Team template not found',
  teamNeedsTwoMembers: 'A team needs at least two members',
  teamTooLarge: 'At most {max} agents per team',
  memberTemplateDeleted: 'A member refers to a predefined agent that was deleted',
  invalidModelName: 'Invalid model name: {model}',
  templateNotFound: 'Template not found',
  engineNotFound: 'Engine not found',
  engineDeleted: 'The engine of this agent was deleted',
  claudeNotFound: 'Claude Code was not found',
  folderMissing: 'Folder is missing: {path}',
  worktreesNeedGit:
    'Worktrees are enabled for “{project}”, but the agent folder is not inside a Git repository (or git is missing).',
  forkOnlyClaude: 'Only Claude Code agents can be forked',
  forkNoTeamMembers: 'Team members cannot be forked',
  forkNoSession: '{name} has no saved conversation yet',
  archiveEntryNotFound: 'Entry not found',
  transcriptGone: 'The transcript of this session no longer exists',
  sessionAlreadyRunning: 'This session is already running',
  workerStopDenied: '{name} belongs to a team – stop the team or ask the orchestrator',
  workerRenameDenied: 'Team members cannot be renamed',
  workerNoOrchestrator: '{name} has no running orchestrator',
  workerObserveOnly: '{name} can only be observed – instructions go to the orchestrator',
  workerQueueDenied: '{name} only gets instructions from the orchestrator',
  editingInTab: '{name} is currently being edited in the editor tab',
  queueTextEmpty: 'The instruction is empty',
  taskEmpty: 'The task is empty',
  taskNotFound: 'Task not found',
  taskOrAgentNotFound: 'Task or agent not found',
  permissionNotOpen: 'This approval is no longer open',

  // Status texts (sidebar, grid header, notifications)
  statusDone: 'Done',
  statusDoneWaiting: 'Done – waiting for input',
  statusAsksQuestion: 'Asks a question',
  statusNeedsInput: 'Needs input',
  statusEngineQuiet: 'No output – probably waiting',
  statusChecksRunning: 'Checks running …',
  statusCheckFailedFixing: 'Check failed – fixing ({round}/{max})',
  statusDoneChecksGreen: 'Done – checks green',
  statusDoneCheckFails: 'Done – check “{command}” fails',
  statusDoneCheckStillFails: 'Done – check “{command}” still fails',
  statusWaitingForOrchestrator: 'Waiting for approval by the orchestrator',
  statusPermission: 'Approval: {action}',

  // Activity log
  activityCheck: 'Check: {command}',
  activityCheckFailed: 'Check failed: {command}',
  activityAutoAllowed: 'Allowed automatically: {action}',

  // Notices (inbox)
  contextWarning:
    '{name}: context at {tokens}k tokens – consider /compact or /clear before it is compacted automatically.'
}

export default en
