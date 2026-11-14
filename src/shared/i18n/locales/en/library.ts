/** English texts (reference): namespace `library` */
const en = {
  // Prompt
  promptTitleEdit: 'Edit prompt',
  promptTitleNew: 'New prompt',
  promptNamePlaceholder: 'e.g. Code review',
  promptNameHelp: 'You pick it by this name – also by voice (“Agent 2, prompt code review”).',
  promptTextLabel: 'Instruction',
  promptTextPlaceholder: 'e.g. Check {{file}} for bugs and suggest improvements.',
  promptPlaceholdersFound: 'Placeholders that are asked for when sending: {names}',
  promptPlaceholdersHelp:
    'Placeholders in double curly braces, e.g. {{file}}, are asked for when sending.',

  // Engine
  engineTitleEdit: 'Edit engine',
  engineTitleNew: 'New engine',
  engineNamePlaceholder: 'e.g. Codex',
  engineNameHelp: 'The started agents get this name (“Codex”, “Codex 2” …).',
  engineCommandLabel: 'Command',
  engineCommandPlaceholder: 'e.g. codex   or   gemini',
  engineCommandHelp:
    'Runs as a terminal program in the agent folder (or worktree). Without Claude hooks these agents have no exact status, no file tabs, checks or permission requests – terminal, grid, voice instructions, jobs and reviewing the changes work.'
}

export default en
