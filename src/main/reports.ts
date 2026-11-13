import type { Agent, EditedFile } from '../shared/types'
import type { AgentManager } from './agents'
import { localDay } from './snippets'
import { getState } from './store'
import { askClaude } from './voiceCommands'

const baseName = (path: string): string => path.split(/[\\/]/).pop() || path

/**
 * Daily report: what did the agents do today per project, what is still open? DevHub collects
 * the facts (agents, last replies, changed files, tasks, ended sessions), a headless Claude
 * instance (Haiku, without tools) writes the report from them.
 */
export async function dailyReport(agents: AgentManager, projectId?: string): Promise<string> {
  const state = getState()
  const today = localDay(Date.now())
  const startOfDay = new Date(new Date().setHours(0, 0, 0, 0)).getTime()
  const projects = state.projects.filter((p) => !projectId || p.id === projectId)
  const running = agents.list()
  const edits = agents.edits()
  const facts: string[] = []

  for (const p of projects) {
    const lines: string[] = []
    for (const a of running.filter((x) => x.projectId === p.id)) lines.push(agentFacts(a, edits))
    for (const s of state.archive.filter((x) => x.projectId === p.id && x.endedAt >= startOfDay)) {
      const tokens = s.usage?.byDay[today]
      lines.push(
        `- Ended session "${s.name}": ${s.title ?? '(no title)'}` +
          (tokens ? ` (output tokens today: ${tokens.output})` : '')
      )
    }
    const tasks = state.tasks.filter((t) => t.projectId === p.id)
    const done = tasks.filter((t) => t.status === 'done' && (t.doneAt ?? 0) >= startOfDay)
    const open = tasks.filter((t) => t.status !== 'done')
    for (const t of done) lines.push(`- Task done today: ${t.text.slice(0, 200)}`)
    for (const t of open)
      lines.push(
        `- Task ${t.status === 'running' ? `in progress (${t.agentName ?? '?'})` : 'open'}: ${t.text.slice(0, 200)}`
      )
    if (lines.length) facts.push(`## Project "${p.name}"`, ...lines, '')
  }
  if (!facts.length) return 'Heute gibt es noch nichts zu berichten.'

  const prompt = [
    'You write a short daily report for a developer who runs several AI coding agents in DevHub.',
    'Use ONLY the facts below. Write in German, as Markdown: one "## <project>" section per project with',
    'the bullet groups "Erledigt", "In Arbeit" and "Offen / wartet auf dich" (omit empty groups).',
    'Be concrete (what was changed, which files/areas), no filler, no invented details. At most 25 lines.',
    '',
    `Date: ${today}`,
    '',
    ...facts
  ].join('\n')
  return (await askClaude(prompt)).trim()
}

function agentFacts(a: Agent, edits: Record<string, EditedFile[]>): string {
  const files = (edits[a.id] ?? []).map((e) => baseName(e.filePath))
  const status =
    a.status === 'needsInput'
      ? `waiting for the user (${a.statusMessage ?? ''})`
      : a.status === 'working'
        ? `working (${a.activity ?? ''})`
        : a.status
  return [
    `- Agent "${a.name}" – ${status}`,
    files.length ? `  edited files: ${[...new Set(files)].slice(0, 15).join(', ')}` : '',
    a.queue?.length ? `  queued instructions: ${a.queue.length}` : '',
    a.lastMessage
      ? `  last answer (start): ${a.lastMessage.slice(0, 500).replace(/\s+/g, ' ')}`
      : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** Short summary of a reply for reading aloud (one or two spoken sentences) */
export async function spokenSummary(agentName: string, lastMessage: string): Promise<string> {
  const prompt = [
    'Summarize the following final answer of an AI coding agent for being read aloud to the user.',
    `Start with the agent name "${agentName}". One or two short spoken sentences in the language of the`,
    'answer: what was done or what the agent needs from the user. No code, no file paths, no Markdown.',
    '',
    `Answer: """${lastMessage.slice(0, 1500)}"""`
  ].join('\n')
  return (await askClaude(prompt)).replace(/[*_`#]/g, '').trim()
}
