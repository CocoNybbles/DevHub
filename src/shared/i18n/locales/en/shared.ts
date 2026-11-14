/** English texts (reference): namespace `shared` */
const en = {
  // agentArgs.ts – validation of the start flags
  argsUnclosedQuote: 'Quotation mark is not closed',
  argsNotAFlag: '“{token}” is not a flag – flags start with - or --',
  argsReservedRestore: '{flag} is not allowed (DevHub sets it itself to restore sessions)',
  argsReservedContinue: '{flag} is not allowed (it would continue a different session)',
  argsReservedFork: '{flag} is not allowed (it would change the session ID, so no restore)',
  argsReservedNoPersistence: '{flag} is not allowed (it prevents restoring sessions)',
  argsReservedSettings:
    '{flag} is not allowed (DevHub sets it itself: hooks for the status display)',
  argsReservedMcp: '{flag} is not allowed (DevHub sets it itself: code view)',
  argsReservedOwn: '{flag} is not allowed (DevHub sets it itself)',
  argsReservedPrint: '{flag} is not allowed (it ends the agent after one answer)',
  argsReservedNoAgent: '{flag} is not allowed (it does not start an agent)',

  // permissions.ts – permission rules
  ruleEmpty: 'Rule is empty',
  ruleBashPrefixMissing: 'The start of the command is missing after “Bash:”',
  ruleCompound: 'The start of the command must not contain chaining or redirection',
  ruleInvalidToolName: 'Invalid tool name: {name}',

  // permissions.ts – activity of an agent (one line per tool call)
  toolRead: 'Reading {file}',
  toolEdit: 'Editing {file}',
  toolWrite: 'Writing {file}',
  toolGrep: 'Searching for “{pattern}”',
  toolGlob: 'Finding files {pattern}',
  toolSubagent: 'Subagent: {text}',
  toolWebFetch: 'Fetching {url}',
  toolWebSearch: 'Web search: {query}',
  toolTodoWrite: 'Updating the to-do list',
  toolAskUser: 'Asking a question',

  // hotkeys.ts – key names in displayed shortcuts
  keyControl: 'Ctrl',
  keySuper: 'Win',
  keySpace: 'Space',
  keyDelete: 'Del',
  keyInsert: 'Ins',
  keyHome: 'Home',
  keyEnd: 'End',
  keyPageUp: 'PgUp',
  keyPageDown: 'PgDn',
  keyEnter: 'Enter',
  keyBackspace: 'Backspace'
}

export default en
