import { spawn } from 'child_process'
import { tmpdir } from 'os'
import type { VoiceCommandResult } from '../shared/types'
import type { AgentManager } from './agents'
import { getState } from './store'
import { claudeEnv, resolveClaude } from './tools'
import { isValidModelName } from '../shared/agentArgs'
import { routerPrompt } from './voicePrompt'

/**
 * Globaler Sprachbefehl: Eine headless Claude-Instanz (`claude -p`, vorhandener Account)
 * ordnet den transkribierten Text einer Aktion zu:
 *   - Anweisung an einen bestehenden Agent (per Name)
 *   - neuen Agent für ein Projekt mit Aufgabe starten
 */

type Decision =
  | { action: 'send'; agentId: string; message: string; promptId?: string }
  | { action: 'start'; projectId: string; task?: string; model?: string; templateId?: string }
  | {
      action: 'start_team'
      projectId: string
      teamTemplateId?: string
      /** Vorlagen-IDs oder 'agent' (normaler Agent) */
      members?: string[]
      teamName?: string
      task?: string
      model?: string
    }
  | { action: 'none'; reason?: string }

export async function runVoiceCommand(
  text: string,
  agents: AgentManager
): Promise<VoiceCommandResult> {
  const { projects, templates, teamTemplates, prompts } = getState()
  const running = agents.list()
  if (projects.length === 0)
    return { kind: 'none', message: 'Es sind noch keine Projekte angelegt.' }

  const prompt = routerPrompt(
    text,
    projects,
    running,
    templates,
    teamTemplates,
    agents.teams(),
    prompts
  )

  const raw = await askClaude(prompt)
  const decision = parseDecision(raw)

  if (decision.action === 'send') {
    const agent = running.find((a) => a.id === decision.agentId)
    // Gespeicherter Prompt aus der Bibliothek (+ ggf. zusätzlich Gesagtes)
    const saved = decision.promptId ? prompts.find((p) => p.id === decision.promptId) : undefined
    const message = [saved?.text, decision.message?.trim()].filter(Boolean).join('\n\n')
    if (!agent || !message) {
      return { kind: 'none', message: 'Agent oder Anweisung nicht erkannt.' }
    }
    const sent = await agents.sendVoice(agent.id, message)
    return {
      kind: 'sent',
      agentName: agent.name,
      message: saved ? `Prompt „${saved.name}“` : message,
      sent
    }
  }

  if (decision.action === 'start') {
    const project = projects.find((p) => p.id === decision.projectId)
    if (!project) return { kind: 'none', message: 'Projekt nicht erkannt.' }
    const model = decision.model?.trim().toLowerCase() || undefined
    if (model && !isValidModelName(model))
      return { kind: 'none', message: `Modell „${model}“ nicht erkannt.` }
    const template = decision.templateId
      ? templates.find((t) => t.id === decision.templateId)
      : undefined
    const agent = await agents.start(project.id, decision.task, model, template?.id)
    return {
      kind: 'started',
      agentName: agent.name,
      projectName: project.name,
      task: decision.task || undefined,
      // angezeigt wird das tatsächlich verwendete Modell (Sprache > Vorlage)
      model: model || template?.model,
      template: template?.name
    }
  }

  if (decision.action === 'start_team') {
    const project = projects.find((p) => p.id === decision.projectId)
    if (!project) return { kind: 'none', message: 'Projekt nicht erkannt.' }
    const model = decision.model?.trim().toLowerCase() || undefined
    if (model && !isValidModelName(model))
      return { kind: 'none', message: `Modell „${model}“ nicht erkannt.` }
    const teamTemplate = decision.teamTemplateId
      ? teamTemplates.find((t) => t.id === decision.teamTemplateId)
      : undefined
    // Unbekannte IDs (Fehlzuordnung) → normaler Agent statt Abbruch
    const members = teamTemplate
      ? undefined
      : (decision.members ?? []).map((id) => ({
          templateId: templates.some((t) => t.id === id) ? id : undefined
        }))
    if (!teamTemplate && (members?.length ?? 0) < 2)
      return { kind: 'none', message: 'Für ein Team bitte mindestens zwei Agents nennen.' }
    const team = await agents.startTeam(project.id, {
      teamTemplateId: teamTemplate?.id,
      members,
      name: decision.teamName,
      task: decision.task,
      model
    })
    return {
      kind: 'teamStarted',
      teamName: team.name,
      projectName: project.name,
      temporary: team.temporary,
      agentNames: agents
        .list()
        .filter((a) => a.teamId === team.id)
        .map((a) => a.name),
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
export async function askClaude(prompt: string): Promise<string> {
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
