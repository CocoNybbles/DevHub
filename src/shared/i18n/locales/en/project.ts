/** English texts (reference): namespace `project` – project dialog and project import */
const en = {
  // ProjectDialog
  editTitle: 'Edit project',
  addTitle: 'Add project',
  optionalTag: '(optional)',
  requiredTag: '(required)',
  namePlaceholder: 'e.g. MyProject',
  agentFolderLabel: '1 · Agent folder',
  agentFolderHint: 'Claude and other AI coding agents are started here.',
  agentFolderPlaceholder: 'C:\\Dev\\MyProject',
  projectFileLabel: '2 · Project file',
  projectFileFoundHint: 'Found automatically in the agent folder.',
  projectFileHint: '.sln or project file, e.g. to open in Visual Studio or Rider.',
  openWithLabel: 'Open with',
  projectFileAppHintSettings:
    'Program for the project file, e.g. Rider or a specific Visual Studio version. Empty = program from the settings.',
  projectFileAppHintDefault:
    'Program for the project file, e.g. Rider or a specific Visual Studio version. Empty = Windows default program.',
  windowsDefaultProgram: 'Windows default program',
  folderLabel: '3 · Folder',
  folderHint: 'Folder that is opened in an editor, e.g. VS Code.',
  useAgentFolderTooltip: 'Use the agent folder',
  useAgentFolder: '= path 1',
  folderAppHintSettings:
    'Program for the folder, e.g. Cursor or another editor. Empty = program from the settings.',
  folderAppHintDefault: 'Program for the folder, e.g. Cursor or another editor. Empty = {program}.',
  windowsExplorer: 'Windows Explorer',
  startFlagsLabel: 'Start flags',
  startFlagsPlaceholder: 'e.g. --permission-mode plan',
  useWorktrees: 'Each agent works in its own Git worktree (own branch)',
  useWorktreesHint:
    'This keeps several agents out of each other’s way; you review and merge their changes via “Review changes”. Requires a Git repository with at least one commit. Unversioned files (e.g. node_modules, .env) are missing in the worktree.',
  checksLabel: 'Checks on “Done”',
  checksHint:
    'One command per line. When an agent has changed files and reports done, they run in its working directory; if one fails, the agent gets the output and fixes it (at most three times per instruction).',
  runCommandsLabel: 'Run commands',
  runCommandsHint:
    'One “name = command” per line. Start/stop and output under “Run” (right-click the project); agents can read the output.',
  previewLabel: 'Web preview',
  permissionRulesLabel: 'Permission rules',
  permissionRulesHint:
    'One rule per line: tool name (e.g. Edit) or “Bash:command prefix”. Matching calls are allowed without asking for agents of this project; chained commands (&&, |, ; …) never match. “Always” in the inbox adds rules here.',

  // ImportProjectsDialog
  importTitle: 'Import projects',
  importNoneFound: 'No projects were found in the selected folders.',
  importNotAdded: 'Not added:\n{list}',
  importAdd_one: 'Add 1 project',
  importAdd_other: 'Add {count} projects',
  importPickFolders: 'Select folders …',
  importPickMoreFolders: 'Select more folders …',
  importPickHint:
    'A folder with several projects (e.g. “C:\\Dev”) or individual project folders – Ctrl+click for several. Looks for Git, .sln, .csproj, package.json, pyproject.toml and others, also in subfolders; the project file (.sln) is found automatically.',
  importScanning: 'Scanning folders …',
  importFoundInFolder: '{count} found in {folder}',
  importFoundInFolders: '{count} found in {folders} folders',
  importNameTooltip: 'Project name',
  importAlreadyRegistered: 'already registered',
  importProjectFile: 'Project file: {file}',
  importNoProjectFile: 'no project file found',
  importStartFlagsLabel: 'Start flags for all'
}

export default en
