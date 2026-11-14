/**
 * Extra start flags for agents (global in settings + per project).
 * Entered as text like in a shell, e.g. `--permission-mode auto --model "opus"`.
 * The arguments go straight to claude.exe without a shell.
 */
import { t, type TranslationKey } from './i18n'

/**
 * Flags that DevHub sets itself or that would break restore/status/terminal,
 * each with the key of the error message (placeholder `{flag}`).
 */
const RESERVED: Record<string, TranslationKey> = {
  '--session-id': 'shared.argsReservedRestore',
  '--resume': 'shared.argsReservedRestore',
  '--continue': 'shared.argsReservedContinue',
  '--fork-session': 'shared.argsReservedFork',
  '--no-session-persistence': 'shared.argsReservedNoPersistence',
  '--settings': 'shared.argsReservedSettings',
  '--mcp-config': 'shared.argsReservedMcp',
  '--append-system-prompt': 'shared.argsReservedOwn',
  '--print': 'shared.argsReservedPrint',
  '--help': 'shared.argsReservedNoAgent',
  '--version': 'shared.argsReservedNoAgent'
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
  return tokens.map((token) => token.replace(/"([^"]*)"|'([^']*)'/g, (_, d, s) => d ?? s))
}

const isFlag = (token: string): boolean => /^-[A-Za-z-]/.test(token)

/** Normalized flag name: `--model=opus` → `--model`, `-r` → `--resume`. */
function flagName(token: string): string {
  const name = token.split('=')[0]
  return ALIASES[name] ?? name
}

/** Groups of flag + its values. */
function groups(tokens: string[]): string[][] {
  const result: string[][] = []
  for (const token of tokens) {
    if (isFlag(token)) result.push([token])
    else if (result.length) result[result.length - 1].push(token)
    else result.push([token]) // free text at the start → error in validate
  }
  return result
}

/** Error message, or null if the flags are usable. */
export function validateAgentArgs(text: string | undefined): string | null {
  const quotes = (text ?? '').replace(/"[^"]*"|'[^']*'/g, '')
  if (/["']/.test(quotes)) return t('shared.argsUnclosedQuote')
  const tokens = tokenize(text ?? '')
  if (tokens.length && !isFlag(tokens[0])) {
    return t('shared.argsNotAFlag', { token: tokens[0] })
  }
  for (const token of tokens) {
    if (!isFlag(token)) continue
    const reserved = RESERVED[flagName(token)]
    if (reserved) return t(reserved, { flag: flagName(token) })
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
