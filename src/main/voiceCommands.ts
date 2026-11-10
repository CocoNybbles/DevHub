import { spawn } from 'child_process'
import { tmpdir } from 'os'
import type { VoiceCommandResult } from '../shared/types'
import type { AgentManager } from './agents'
import { getState } from './store'
import { claudeEnv, resolveClaude } from './tools'

/**
 * Globaler Sprachbefehl: Eine headless Claude-Instanz (`claude -p`, vorhandener Account)
 * ordnet den transkribierten Text einer Aktion zu:
 *   - Anweisung an einen bestehenden Agent (per Name)
 *   - neuen Agent für ein Projekt mit Aufgabe starten
 */

type Decision =
  | { action: 'send'; agentId: string; message: string }
  | { action: 'start'; projectId: string; task?: string }
  | { action: 'none'; reason?: string }

export async function runVoiceCommand(
  text: string,
  agents: AgentManager
): Promise<VoiceCommandResult> {
  const projects = getState().projects
  const running = agents.list()
  if (projects.length === 0)
    return { kind: 'none', message: 'Es sind noch keine Projekte angelegt.' }

  const prompt = [
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
    'Decide what the user wants and answer with ONLY one JSON object, no other text:',
    '{"action":"send","agentId":"<id>","message":"<instruction for the agent>"}',
    '  → the user addresses an existing agent by name. "message" is the instruction without the addressing part, in the language the user spoke.',
    '{"action":"start","projectId":"<id>","task":"<task or empty>"}',
    '  → the user wants a new agent for a project (optionally with a task, in the language the user spoke).',
    '{"action":"none","reason":"<short reason in German>"}',
    '  → unclear, or the named agent/project does not exist.',
    'Match names fuzzily (e.g. "Agent eins" / "agent one" = "Agent 1"; similar sounding project names).'
  ].join('\n')

  const raw = await askClaude(prompt)
  const decision = parseDecision(raw)

  if (decision.action === 'send') {
    const agent = running.find((a) => a.id === decision.agentId)
    if (!agent || !decision.message?.trim()) {
      return { kind: 'none', message: 'Agent oder Anweisung nicht erkannt.' }
    }
    await agents.sendLine(agent.id, decision.message.trim())
    return { kind: 'sent', agentName: agent.name, message: decision.message.trim() }
  }

  if (decision.action === 'start') {
    const project = projects.find((p) => p.id === decision.projectId)
    if (!project) return { kind: 'none', message: 'Projekt nicht erkannt.' }
    const agent = await agents.start(project.id, decision.task)
    return {
      kind: 'started',
      agentName: agent.name,
      projectName: project.name,
      task: decision.task || undefined
    }
  }

  return { kind: 'none', message: decision.reason || 'Befehl nicht verstanden.' }
}

function parseDecision(raw: string): Decision {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return { action: 'none', reason: 'Keine verwertbare Antwort.' }
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return { action: 'none', reason: 'Antwort konnte nicht gelesen werden.' }
  }
}

/** Ruft `claude -p` ohne Tools auf; der Prompt geht über stdin (kein Quoting nötig). */
async function askClaude(prompt: string): Promise<string> {
  const claude = await resolveClaude()
  if (!claude) throw new Error('Claude Code wurde nicht gefunden')

  const isExe = claude.toLowerCase().endsWith('.exe')
  const args = [
    '-p',
    '--model',
    'haiku',
    '--output-format',
    'json',
    // Leerer Wert = alle Tools aus. Node quotet '' bei .exe selbst, für cmd.exe explizit
    '--tools',
    isExe ? '' : '""',
    '--strict-mcp-config',
    '--no-session-persistence'
  ]

  return new Promise((resolve, reject) => {
    const child = spawn(isExe ? claude : 'cmd.exe', isExe ? args : ['/c', claude, ...args], {
      cwd: tmpdir(),
      env: claudeEnv(),
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill(), 60_000)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0)
        return reject(new Error(`claude -p fehlgeschlagen: ${stderr || stdout}`.trim()))
      try {
        const result = JSON.parse(stdout)
        if (result.is_error) return reject(new Error(String(result.result)))
        resolve(String(result.result ?? ''))
      } catch {
        resolve(stdout)
      }
    })
    child.stdin.end(prompt)
  })
}
