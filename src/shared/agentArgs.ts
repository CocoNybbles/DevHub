/**
 * Zusätzliche Start-Flags für Agents (global in den Einstellungen + pro Projekt).
 * Eingabe als Text wie in einer Shell, z. B. `--permission-mode auto --model "opus"`.
 * Die Argumente gehen ohne Shell direkt an claude.exe.
 */

/** Flags, die DevHub selbst setzt bzw. die Wiederherstellung/Status/Terminal kaputt machen würden. */
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

/** Zerlegt Text in Argumente; "…" und '…' gruppieren, Backslashes bleiben erhalten (Windows-Pfade). */
export function tokenize(text: string): string[] {
  // Ein Token = Folge aus unquotierten Zeichen und quotierten Abschnitten (z. B. --model="opus 4")
  const tokens = text.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
  return tokens.map((t) => t.replace(/"([^"]*)"|'([^']*)'/g, (_, d, s) => d ?? s))
}

const isFlag = (t: string): boolean => /^-[A-Za-z-]/.test(t)

/** Normierter Flag-Name: `--model=opus` → `--model`, `-r` → `--resume`. */
function flagName(token: string): string {
  const name = token.split('=')[0]
  return ALIASES[name] ?? name
}

/** Gruppen aus Flag + zugehörigen Werten. */
function groups(tokens: string[]): string[][] {
  const result: string[][] = []
  for (const t of tokens) {
    if (isFlag(t)) result.push([t])
    else if (result.length) result[result.length - 1].push(t)
    else result.push([t]) // freier Text am Anfang → Fehler in validate
  }
  return result
}

/** Fehlermeldung oder null, wenn die Flags verwendbar sind. */
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
 * Effektive Argumente: globale Flags, ergänzt um die Projekt-Flags.
 * Gibt es ein Flag in beiden, gewinnt das Projekt (die globale Angabe entfällt).
 */
export function mergeAgentArgs(
  globalArgs: string | undefined,
  projectArgs: string | undefined,
  /** Bereits zerlegte Flags mit höchstem Vorrang (z. B. per Sprache genanntes `--model`) */
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

/** Gültiger Wert für `--model`: Alias (fable, opus, sonnet, haiku …) oder voller Modellname. */
export function isValidModelName(model: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:\-[\]]{0,79}$/.test(model)
}
