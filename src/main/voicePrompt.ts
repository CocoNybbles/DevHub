import type { Agent, AgentTemplate, Project, Team, TeamTemplate } from '../shared/types'
import { teamLead } from '../shared/types'

/**
 * Prompt for the voice command router (`claude -p`). Pure function without Electron dependency,
 * so it can be tested by script against real Claude.
 */
export function routerPrompt(
  text: string,
  projects: Project[],
  running: Agent[],
  templates: AgentTemplate[],
  teamTemplates: TeamTemplate[] = [],
  teams: Team[] = []
): string {
  const templateName = (id?: string): string =>
    templates.find((t) => t.id === id)?.name ?? 'general agent'
  /** Contact of a running team = orchestrator (older teams: oldest member) */
  const lead = (teamId: string): Agent | undefined => teamLead(running, teamId)
  return [
    'You route voice commands inside DevHub, an app that manages AI coding agents per project.',
    'The command was transcribed by speech recognition and may contain recognition errors.',
    '',
    `Command: """${text}"""`,
    '',
    'Projects:',
    ...projects.map((p) => `- id=${p.id} name="${p.name}"`),
    '',
    'Running agents:',
    ...(running.length
      ? running.map(
          (a) =>
            `- id=${a.id} name="${a.name}" project="${projects.find((p) => p.id === a.projectId)?.name}"`
        )
      : ['(none)']),
    '',
    'Agent templates (predefined named agents with a role, e.g. "Developer"):',
    ...(templates.length ? templates.map((t) => `- id=${t.id} name="${t.name}"`) : ['(none)']),
    '',
    'Team templates (predefined teams of agents):',
    ...(teamTemplates.length
      ? teamTemplates.map(
          (t) =>
            `- id=${t.id} name="${t.name}" members=[${t.members.map((m) => templateName(m.templateId)).join(', ')}]`
        )
      : ['(none)']),
    '',
    'Running teams:',
    ...(teams.length
      ? teams.map(
          (t) =>
            `- name="${t.name}" project="${projects.find((p) => p.id === t.projectId)?.name}" leadAgentId=${lead(t.id)?.id ?? '(none)'}`
        )
      : ['(none)']),
    '',
    'Decide what the user wants and answer with ONLY one JSON object, no other text:',
    '{"action":"send","agentId":"<id>","message":"<instruction for the agent>"}',
    '  → the user addresses an existing (running) agent by name. "message" is the instruction without the addressing part, in the language the user spoke.',
    '  A running agent always wins over a template with a similar name (e.g. "Entwickler, schreib Tests" → send to the running agent "Entwickler").',
    "  If the user addresses a running team by name, send to that team's leadAgentId.",
    '{"action":"start_team","projectId":"<id>","teamTemplateId":"<team template id or empty>","members":["<template id or \'agent\'>", ...],"teamName":"<name or empty>","task":"<task or empty>","model":"<model or empty>"}',
    '  → the user wants several agents started together as a team for a project.',
    '  Predefined team (e.g. "Starte das Team Feature für DevHub"): set "teamTemplateId", "members" = [].',
    '  Ad-hoc team (e.g. "Starte einen Entwickler und einen Reviewer als Team für DevHub"): "teamTemplateId" = "", list every member in "members" (one entry per agent, repeat for "zwei Entwickler"); use "agent" for a plain agent without template. An orchestrator agent is added automatically and coordinates the members, so list only the working members (never an "orchestrator").',
    '  "teamName": only if the user names the ad-hoc team, otherwise "". "task": the task for the whole team. "model": as for "start", applies to all members.',
    '  Use "start_team" only when the user clearly asks for a team or for several agents together; a single agent is "start".',
    '{"action":"start","projectId":"<id>","task":"<task or empty>","model":"<model or empty>","templateId":"<template id or empty>"}',
    '  → the user wants a new agent for a project (optionally with a task, in the language the user spoke).',
    '  "templateId": if the user asks for a new agent by a template name or role (e.g. "Starte einen Entwickler für DevHub" with template "Entwickler"), otherwise "".',
    '  If the user addresses a template name that is not running and gives an instruction, start it with that instruction as task.',
    '  "model": only if the user explicitly names a Claude model for the new agent, otherwise "".',
    '  Use the lowercase alias of the model family: "fable", "opus", "sonnet" or "haiku" (speech recognition may garble them, e.g. "Sonett" = sonnet, "Opas"/"Opus" = opus, "Haiku"/"Hai Ku" = haiku).',
    '  Only if a specific version is named, use the full name, e.g. "Opus 5.5" = "claude-opus-5-5", "Sonnet 5.5" = "claude-sonnet-5-5".',
    '  The model mention is NOT part of "task" (e.g. "Starte mit Opus einen Agent für DevHub, der die Tests fixt" → model "opus", task "Fixe die Tests").',
    '{"action":"none","reason":"<short reason in German>"}',
    '  → unclear, or the named agent/project does not exist.',
    'If only one project exists, use it when the user does not name one.',
    'Match names fuzzily (e.g. "Agent eins" / "agent one" = "Agent 1", "Entwickler zwei" = "Entwickler 2"; similar sounding project and template names, also across languages, e.g. "developer" = "Entwickler").'
  ].join('\n')
}
