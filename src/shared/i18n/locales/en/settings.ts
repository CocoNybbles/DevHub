/** English texts (reference): namespace `settings` */
const en = {
  // Interface language
  languageTitle: 'Language',
  languageLabel: 'Interface language',
  languageSystem: 'System language',

  // Agent start
  agentStartTitle: 'Agent start',
  agentArgsLabel: 'Additional start flags for all agents',
  agentArgsPlaceholder: 'e.g. --permission-mode auto',
  argsHelpGlobal: 'Passed to every newly started or restored agent.',
  argsHelpProject:
    'Added to the global flags from the settings; flags with the same name replace the global ones.',
  argsHelpExamples: 'Examples:',
  argsHelpApplies: 'Applies from the next agent start.',

  // Predefined agents
  templatesTitle: 'Predefined agents',
  templateModelFromFlags: 'Model from start flags',
  confirmDeleteTemplate: 'Delete template “{name}”?',
  newTemplate: 'New predefined agent …',
  templatesHelp:
    'Named agents with their own model and guidelines. Start them with the ▶ button on the project or by voice (“Start a developer for DevHub that …”); address running ones by their name.',

  // Teams
  confirmDeleteTeam: 'Delete team “{name}”?',
  newTeam: 'New team …',
  teamsHelp:
    'Several agents that start together for a project and may send each other messages. Start with ▶ on the project or by voice (“Start the team Feature for DevHub”). A temporary team also works by voice: “Start a developer and a reviewer as a team for DevHub, …”.',

  // Prompt library
  promptsTitle: 'Prompt library',
  confirmDeletePrompt: 'Delete prompt “{name}”?',
  newPrompt: 'New prompt …',
  promptsHelp:
    'Reusable instructions with placeholders. To send: right-click an agent → “Instruction / prompt from the library” or by voice (“Agent 2, prompt code review”).',

  // Other engines
  enginesTitle: 'Other engines',
  confirmDeleteEngine: 'Delete engine “{name}”?',
  newEngine: 'New engine …',
  enginesHelp:
    'Coding agents other than Claude Code (e.g. Codex CLI, Gemini CLI) as a terminal program. Start with ▶ on the project. Without Claude hooks only with a simplified status.',

  // Inbox and notifications
  inboxTitle: 'Inbox and notifications',
  notifyOnWaiting: 'Windows notification when an agent is waiting and DevHub is in the background',
  permissionInbox: 'Decide permission requests in the inbox (instead of in the agent’s terminal)',
  permissionInboxHelp:
    '“Always” creates a rule for the project (Edit project → Permission rules). Rules apply even without this setting.',
  voiceReadback: 'Finished agents: read a summary of the answer aloud',
  voiceReadbackHelp:
    'Claude (Haiku) summarizes the answer in one or two sentences; it is read aloud with the Windows speech output.',

  // Usage
  usageTitle: 'Usage',
  contextWarnLabel: 'Context warning from (tokens)',
  contextWarnHelp: 'Notice in the inbox as soon as an agent’s conversation is this large. 0 = off.',
  priceInputLabel: 'Input price (USD per million tokens)',
  priceInputHelp:
    'For the cost estimate in the history. 0 = no cost display (e.g. with a subscription).',
  priceOutputLabel: 'Output price (USD per million tokens)',
  priceOutputHelp: 'Cache reads are calculated at 10 %, cache writes at 125 % of the input price.',

  // Remote access
  remoteTitle: 'Remote access',
  remoteEnable: 'Enable remote access in the local network (e.g. for your phone)',
  remoteHelp:
    'Shows the agents with status and last answer, accepts instructions and decides permission requests from the inbox. The connection is unencrypted (HTTP) and protected only by the secret part of the address – use it only in a trusted network or through a VPN. Windows may ask for firewall access when you first enable it.',
  remotePort: 'Port',
  remoteNoAddress: 'No network address found.',
  remoteCopy: 'copy',
  remoteNewAddressTooltip: 'Creates a new address – existing links stop working afterwards',
  remoteNewAddress: 'Create new address',

  // File preview
  filePreviewTitle: 'File preview',
  showEditedFiles: 'Show files edited by the agent as tabs on the right',
  showEditedFilesHelp:
    'Changed lines are highlighted. Places an agent shows deliberately and snippets appear regardless.',

  // Open with
  openWithTitle: 'Open with',
  projectFileAppLabel: 'Project files (path 2)',
  projectFileAppPlaceholder: 'Windows default program for the file extension',
  projectFileAppHelp:
    'Path to the .exe, e.g. Visual Studio or Rider. Empty = the program Windows uses for the file extension.',
  folderAppLabel: 'Folders (path 3)',
  windowsExplorer: 'Windows Explorer',
  folderAppHelpVscode: 'Path to the .exe, e.g. VS Code, Cursor or another editor. Empty = VS Code.',
  folderAppHelpExplorer:
    'Path to the .exe, e.g. VS Code, Cursor or another editor. Empty = Windows Explorer (VS Code is not installed).',
  openWithPerProject: 'Both can be set differently per project.',
  programUseDefault: 'Use default',
  programReset: 'Reset',

  // Voice
  voiceModelTitle: 'Speech model',
  voiceTitle: 'Voice instructions',
  voiceAutoSend: 'Send recognized text right away (otherwise only type it into the terminal)',
  voiceAutoSendHelp: 'Can be set differently per agent: right-click the agent in the list.',
  spokenLanguageLabel: 'Spoken language',
  spokenLanguageAuto: 'Detect automatically',
  spokenLanguageAlways: 'Always {language}',
  spokenLanguageFixedHelp:
    'Fixed language: fastest and most reliable. Other languages are then recognized incorrectly or translated, however.',
  voiceRememberLanguage:
    'Remember the last detected language and try it first (faster recognition)',
  rememberedBefore: 'Remembered: ',
  rememberedAfter: ' – if the result seems uncertain, the language is detected again.',
  rememberedForget: 'Forget',
  rememberedNone:
    'No language remembered yet – it is detected with the next recording. English is never remembered (whisper would otherwise translate other languages into English).',

  // Hotkeys
  hotkeysTitle: 'Keyboard shortcuts',
  hotkeyAgentVoice: 'Voice instruction to the active agent (in the app)',
  hotkeyGlobalVoice: 'System-wide voice command: address an agent by name or start a new agent',
  hotkeyEditor:
    'Write an instruction for the active agent in a tab (with dictation and images; in the app)',
  hotkeyCancelRecording: 'Cancel the running recording',
  hotkeysHelp:
    'Pressing the shortcut again ends the recording. To change it, click “Change” and press the new key combination (with Ctrl, Alt or Win, or an F key).',
  hotkeyNeedsModifier: 'Combine with Ctrl, Alt or Win (or use an F key)',
  hotkeyPress: 'Press key combination … (Esc = cancel)',
  hotkeyChange: 'Change'
}

export default en
