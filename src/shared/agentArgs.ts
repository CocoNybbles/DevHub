/**
 * Extra start flags for agents (global in settings + per project).
 * Entered as text like in a shell, e.g. `--permission-mode auto --model "opus"`.
 * The arguments go straight to claude.exe without a shell.
 */

/** Flags that DevHub sets itself or that would break restore/status/terminal. */
const RESERVED: Record<string, string> = {
  '--session-id': 'setzt DevHub für die Wiederherstellung selbst',
  '--resume': 'setzt DevHub für die Wiederherstellung selbst',
  '--continue': 'würde eine andere Session fortsetzen',
  '--fork-session': 'würde die Session-ID ändern (keine Wiederherstellung)',
  '--no-session-persistence': 'verhindert die Wiederherstellung',
  '--settings': 'setzt DevHub selbst (Hooks für die Statusanzeige)',
  '--mcp-config': 'setzt DevHub selbst (Code-Ansicht)',
  '--append-system-prompt': 'setzt DevHub selbst',
  '--print': 'beendet den Agent nach einer Antwort',
  '--help': 'startet keinen Agent',
  '--version': 'startet keinen Agent'
}

const ALIASES: Record<string, string> = {
  '-r': '--resume',
  '-c': '--continue',
  '-p': '--print',
  '-h': '--help',
  '-v': '--version'
}

/** Splits text into arguments; "…" and '…' group, backslashes are kept (Windows paths). */
export function tokenize(text: string): string[] {
  // A token = sequence of unquoted characters and quoted sections (e.g. --model="opus 4")
  const tokens = text.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
  return tokens.map((t) => t.replace(/"([^"]*)"|'([^']*)'/g, (_, d, s) => d ?? s))
}

const isFlag = (t: string): boolean => /^-[A-Za-z-]/.test(t)

/** Normalized flag name: `--model=opus` → `--model`, `-r` → `--resume`. */
function flagName(token: string): string {
  const name = token.split('=')[0]
  return ALIASES[name] ?? name
}

/** Groups of flag + its values. */
function groups(tokens: string[]): string[][] {
  const result: string[][] = []
  for (const t of tokens) {
    if (isFlag(t)) result.push([t])
    else if (result.length) result[result.length - 1].push(t)
    else result.push([t]) // free text at the start → error in validate
  }
  return result
}

/** Error message, or null if the flags are usable. */
export function validateAgentArgs(text: string | undefined): string | null {
  const quotes = (text ?? '').replace(/"[^"]*"|'[^']*'/g, '')
  if (/["']/.test(quotes)) return 'Anführungszeichen nicht geschlossen'
  const tokens = tokenize(text ?? '')
  if (tokens.length && !isFlag(tokens[0])) {
    return `„${tokens[0]}“ ist kein Flag – Flags beginnen mit - oder --`
  }
  for (const t of tokens) {
    if (!isFlag(t)) continue
    const reason = RESERVED[flagName(t)]
    if (reason) return `${flagName(t)} ist nicht erlaubt (${reason})`
  }
  return null
}

/**
 * Effective arguments: global flags, extended by the project flags.
 * If a flag is in both, the project wins (the global one is dropped).
 */
export function mergeAgentArgs(
  globalArgs: string | undefined,
  projectArgs: string | undefined,
  /** Already split flags with the highest precedence (e.g. `--model` named by voice) */
  agentArgs: string[] = []
): string[] {
  let merged: string[][] = []
  for (const layer of [tokenize(globalArgs ?? ''), tokenize(projectArgs ?? ''), agentArgs]) {
    const grps = groups(layer)
    const overridden = new Set(grps.map((grp) => flagName(grp[0])))
    merged = [...merged.filter((grp) => !overridden.has(flagName(grp[0]))), ...grps]
  }
  return merged.flat()
}

/** Valid value for `--model`: alias (fable, opus, sonnet, haiku …) or full model name. */
export function isValidModelName(model: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:\-[\]]{0,79}$/.test(model)
}
