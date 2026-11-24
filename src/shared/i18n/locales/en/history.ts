/** English texts (reference): namespace `history` – ended sessions, search, usage */
const en = {
  title: 'History',
  removedProject: '(removed project)',
  usage: '{input} in · {output} out',
  usageWithCost: '{input} in · {output} out · ≈ {cost}',
  entryMeta: '· {project} · ended {date}',
  entryMetaWorktree: '· {project} · ended {date} · worktree {branch}',
  noInstruction: '(no instruction)',
  resumeTooltip: 'Continue the session as an agent',
  resume: 'Resume',
  forkTooltip: 'Continue as a copy – the entry stays in the history',
  fork: 'Fork',
  removeTooltip: 'Only removes it from the history (the transcript stays on disk)',
  remove: 'remove',
  searchPlaceholder: 'Search all conversations (running and ended) …',
  searching: 'Searching …',
  search: 'Search',
  back: 'Back',
  noMatches: 'No matches.',
  matchMetaRunning: '· {project} · running',
  matchMetaEnded: '· {project} · ended',
  show: 'Show',
  usageHeading: 'Usage',
  usageToday: 'Today',
  usageTotal: 'Total (known sessions)',
  costHint: 'For a cost estimate, enter the prices per million tokens in the settings.',
  endedHeading: 'Ended sessions',
  endedEmpty: 'None yet. Ended agents appear here and can be resumed.',

  // Resume session … (sessions of a project on disk)
  localTitle: 'Resume session – {project}',
  localFilter: 'Filter by title, instruction, branch or session id …',
  localLoading: 'Looking for sessions …',
  localEmpty: 'No sessions of this project were found on this computer.',
  localSize: '{size} MB',
  localWorktree: 'worktree {branch}',
  localRunningAs: 'running as {name}',
  localInHistoryAs: 'in the history as {name}',
  localResumeTooltip: 'Start an agent that continues this session (claude --resume)',
  localForkTooltip: 'Start an agent with a copy of this session – the original stays unchanged',
  localStarting: 'Starting …',
  localRecent: 'active just now – is it running somewhere else?',
  localConfirmActive:
    'This session was written to just now and may still be running in another terminal. Two processes would then write into the same conversation.\n\nResume it anyway? (A copy is always safe.)',
  localItemTooltip: 'Session {id}\nin {cwd}',
  localTeam: 'former team member',
  localTeamTooltip:
    'Resumed as a single agent without its team: the team tools (messages, approvals) mentioned in the conversation no longer work.',
  localHelp:
    'All Claude Code sessions that ran in the agent folder or in one of the project’s worktrees, including those started outside DevHub. Newest first, at most 100.'
}

export default en
