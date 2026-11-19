/** English texts (reference): namespace `templates` */
const en = {
  // Predefined agent
  invalidModelName: 'Invalid model name',
  agentTitleEdit: 'Predefined agent: {name}',
  agentTitleNew: 'New predefined agent',
  agentNameHelp:
    'The agent gets this name when it starts (further ones: “{name} 2” …) and you address it by voice with it, e.g. “Start a {example} for DevHub”.',
  agentNameExample: 'developer',
  agentNamePlaceholder: 'e.g. Developer, Reviewer, Tester',
  modelHelp:
    'Empty = as in the start flags. A model you name in the voice command takes precedence.',
  modelPlaceholder: 'e.g. opus, sonnet or claude-opus-5-5',
  roleLabel: 'Role and guidelines',
  roleHelp:
    'Given to the agent as an instruction on every start, e.g. how it should work, test and commit. Dictate with the microphone.',
  rolePlaceholder:
    'e.g. You are an experienced developer. Write tests for every change, follow the conventions in CLAUDE.md and briefly explain what you changed.',

  // Team
  teamTitleEdit: 'Team: {name}',
  teamTitleNew: 'New team',
  teamNameHelp: 'Can be started by voice, e.g. “Start the team {name} for DevHub”.',
  teamNameExample: 'Feature',
  teamNamePlaceholder: 'e.g. Feature, Bugfix, Review',
  membersLabel: 'Members',
  membersHelp:
    'An orchestrator starts automatically in addition: it receives the task, distributes it to the members, decides on their permission requests and reports to you. You can only watch the members.',
  normalAgent: 'Normal agent',
  addMember: '+ Member',
  noTemplatesTip:
    'Tip: create predefined agents first (e.g. Developer, Reviewer) to give them roles.',
  sharedGuidelinesLabel: 'Shared guidelines',
  sharedGuidelinesHelp:
    'Applies to all members in addition to their own guidelines, e.g. workflow and handovers. Dictate with the microphone.',
  sharedGuidelinesPlaceholder:
    'e.g. The developer implements and then hands over to the reviewer. The reviewer checks and reports findings back until everything fits. Only then is it committed.'
}

export default en
