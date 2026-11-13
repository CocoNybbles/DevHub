/**
 * A project's permission rules and short descriptions of tool calls.
 * Rule = `Tool` (e.g. `Edit`, `mcp__server__tool`) or `Bash:<command prefix>` (e.g. `Bash:npm test`).
 */

type Input = Record<string, unknown> | undefined

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const baseName = (path: string): string => path.split(/[\\/]/).pop() || path
const short = (text: string, max: number): string =>
  text.length > max ? text.slice(0, max - 1) + '…' : text

/**
 * Chained or redirected commands never match a `Bash:` rule – otherwise
 * "git status && rm -rf …" would slip through via the rule "git status".
 */
const COMPOUND = /[;&|<>`\n\r]|\$\(/

/** Rule that "Immer erlauben" (always allow) saves for this call */
export function ruleFor(tool: string, input: Input): string {
  if (tool !== 'Bash') return tool
  const command = str(input?.command).trim()
  if (!command || COMPOUND.test(command)) return ''
  // Program + first subcommand, e.g. "npm test", "git status", "dotnet build"
  const words = command.split(/\s+/)
  const second = words[1] && /^[a-z][\w:-]*$/i.test(words[1]) ? ` ${words[1]}` : ''
  return `Bash:${words[0]}${second}`
}

export function matchesRule(rule: string, tool: string, input: Input): boolean {
  const r = rule.trim()
  if (!r) return false
  if (!r.toLowerCase().startsWith('bash:')) return r === tool
  if (tool !== 'Bash') return false
  const prefix = r.slice(5).trim()
  const command = str(input?.command).trim()
  if (!prefix || !command || COMPOUND.test(command)) return false
  return command === prefix || command.startsWith(prefix + ' ')
}

/** Error message or null */
export function validateRule(rule: string): string | null {
  const r = rule.trim()
  if (!r) return 'Regel ist leer'
  if (r.toLowerCase().startsWith('bash:')) {
    const prefix = r.slice(5).trim()
    if (!prefix) return 'Nach „Bash:“ fehlt der Befehlsanfang'
    if (COMPOUND.test(prefix)) return 'Befehlsanfang darf keine Verkettung/Umleitung enthalten'
    return null
  }
  return /^[\w.-]+$/.test(r) ? null : `Ungültiger Tool-Name: ${r}`
}

/** What a tool call does, in one line for the activity display */
export function describeTool(tool: string, input: Input): string {
  const file = baseName(str(input?.file_path) || str(input?.path) || str(input?.notebook_path))
  switch (tool) {
    case 'Read':
      return `Liest ${file}`
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Bearbeitet ${file}`
    case 'Write':
      return `Schreibt ${file}`
    case 'Bash':
    case 'PowerShell':
      return `$ ${short(str(input?.command).replace(/\s+/g, ' '), 90)}`
    case 'Grep':
      return `Sucht „${short(str(input?.pattern), 50)}“`
    case 'Glob':
      return `Sucht Dateien ${short(str(input?.pattern), 50)}`
    case 'Task':
    case 'Agent':
      return `Subagent: ${short(str(input?.description) || str(input?.prompt), 70)}`
    case 'WebFetch':
      return `Lädt ${short(str(input?.url), 70)}`
    case 'WebSearch':
      return `Websuche: ${short(str(input?.query), 60)}`
    case 'TodoWrite':
      return 'Aktualisiert die Aufgabenliste'
    case 'AskUserQuestion':
      return 'Stellt eine Frage'
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  return mcp ? `${mcp[2]} (${mcp[1]})` : tool
}
