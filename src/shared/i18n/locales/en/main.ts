/** English texts (reference): namespace `main` */
const en = {
  // dataPath.ts
  dataDirNotWritable:
    'DevHub stores its data next to the program file but has no write access to:\n{dir}\n\nPlease move DevHub to a writable folder (e.g. not under “Program Files”).',

  // claudeAuth.ts
  authExpired: 'Your login has expired.',
  authStatusUnreadable: 'The response of `claude auth status` could not be read.',

  // tools.ts
  invalidPath: 'Invalid path',
  pathNotFound: 'Path not found: {path}',
  programFullPath: 'Program: please enter the full path',
  programExtension: 'Program: must be an .exe (or .cmd/.bat)',
  programNotFound: 'Program not found: {path}',
  programStartFailed: 'The program could not be started: {error}',

  // index.ts – generic
  quoted: '“{name}”',
  projectNotFound: 'Project not found',
  nameMissing: 'Name is missing',
  nameEndsWithNumber: 'The name must not end with a number',
  agentNameReserved: '“Agent N” is reserved for regular agents',

  // index.ts – review (Git)
  reviewMainFolder: 'Main folder',
  reviewMainFolderBranch: 'Main folder ({branch})',
  reviewEndedAgent: '{name} (ended)',
  workdirNotFound: 'Working directory not found',
  mergeOnlyWorktrees: 'Only worktrees can be merged',
  mainFolderNotRemovable: 'The main folder cannot be removed',
  worktreeAgentRunning: 'An agent is still running in this worktree – stop it first',

  // index.ts – web preview
  previewUrlMissing: 'No preview address is set for “{name}” (edit the project)',
  previewTitle: 'Preview · {name}',

  // index.ts – projects
  agentPathMissing: 'Agent path does not exist',
  projectFileMissing: 'Project file does not exist',
  folderPathMissing: 'Folder (path 3) does not exist',
  startFlagsError: 'Start flags: {error}',
  commandsIncomplete: 'Commands: name and command must both be filled in',
  commandOneLineNamed: 'Command “{name}”: one line only',
  commandNamesNotUnique: 'Commands: names must be unique',
  permissionRuleError: 'Permission rule “{rule}”: {error}',
  previewUrlInvalid: 'The preview address must start with http:// or https://',
  worktreesNoRepo: 'Worktrees: the agent folder is not inside a Git repository (or git is missing)',
  projectFileNotFound: 'Project file not found: {path}',
  folderNotFound: 'Folder not found: {path}',
  filterPrograms: 'Programs',
  filterAllFiles: 'All files',
  filterSolutions: 'Solutions & projects',
  filterImages: 'Images',
  pickFoldersTitle: 'Select folders with projects (Ctrl+click for several)',
  pickFilesTitle: 'Attach images or files',

  // index.ts – predefined agents and teams
  templateNameEndsWithNumber: 'The name must not end with a number (used for “Name 2”, “Name 3”)',
  templateExists: 'A template named “{name}” already exists',
  invalidModelName: 'Invalid model name: {model}',
  templateUsedInTeams: 'Used in team {teams}',
  teamNameReserved: '“Team N” is reserved for temporary teams',
  teamNameEndsWithNumber: 'The name must not end with a number (used for “Name 2”)',
  teamExists: 'A team named “{name}” already exists',
  teamTooFewMembers: 'A team needs at least two members',
  teamTooManyMembers: 'No more than 8 members',

  // index.ts – inbox, tasks
  invalidAnswer: 'Invalid answer',
  invalidStatus: 'Invalid status',

  // index.ts – prompt library, engines
  textMissing: 'Text is missing',
  promptExists: 'A prompt named “{name}” already exists',
  commandMissing: 'Command is missing',
  commandOneLine: 'Command: one line only',
  engineNameTaken: 'The name “{name}” is already taken (engine or predefined agent)',
  engineInUse: 'An agent is still running with this engine',

  // index.ts – code view
  fileTooLarge: 'File is too large (> 5 MB)',

  // index.ts – notification after a global voice command
  voiceAgentStarted: '{agent} started ({project})',
  voiceTeamStarted: 'Team {team} started ({project}): {agents}',

  // index.ts – settings
  hotkeyMissing: 'Shortcut is missing',
  hotkeyDuplicate: 'This shortcut is already assigned to another action',
  hotkeyUnavailable: 'The shortcut {hotkey} is invalid or used by another application',
  numberOutOfRange: '{label}: value between {min} and {max} expected',
  labelContextWarning: 'Context warning',
  labelPriceInput: 'Input price',
  labelPriceOutput: 'Output price',
  labelPort: 'Port'
}

export default en
