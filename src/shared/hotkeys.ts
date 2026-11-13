/**
 * Keyboard shortcuts in Electron accelerator format (e.g. "Control+Shift+Space").
 * The main process uses the same format for `globalShortcut` and the renderer
 * for in-app detection – hence shared here.
 */

export const DEFAULT_HOTKEYS = {
  /** In the app: voice instruction to the active agent */
  agentVoice: 'Control+Shift+Space',
  /** System-wide: address an agent by name / start a new agent */
  globalVoice: 'Control+Alt+Space',
  /** In the app: write an instruction for the active agent in the editor tab */
  editor: 'Control+G'
} as const

const MODIFIERS = ['Control', 'Alt', 'Shift', 'Super'] as const

const NAMED_KEYS: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Pause: 'Pause',
  ScrollLock: 'Scrolllock',
  PrintScreen: 'PrintScreen'
}

/** Key (without modifiers) from `KeyboardEvent.code` – layout-independent. */
function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return 'num' + code.slice(6)
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code
  return NAMED_KEYS[code] ?? null
}

type KeyLike = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>

/**
 * Accelerator from a key press, or null if it is not (yet) a valid shortcut:
 * modifier key only, unknown key, or without Ctrl/Alt/Win (except F keys).
 */
export function acceleratorFromEvent(e: KeyLike): string | null {
  const key = keyFromCode(e.code)
  if (!key) return null
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Super')
  const hasMainModifier = e.ctrlKey || e.altKey || e.metaKey
  if (!hasMainModifier && !/^F\d+$/.test(key)) return null
  return [...mods, key].join('+')
}

/** Compares a key press with an accelerator (modifier order doesn't matter). */
export function matchesAccelerator(e: KeyLike, accelerator: string): boolean {
  const pressed = acceleratorFromEvent(e)
  return pressed !== null && normalize(pressed) === normalize(accelerator)
}

function normalize(accelerator: string): string {
  const parts = accelerator.split('+')
  const key = parts.pop() ?? ''
  const mods = MODIFIERS.filter((m) => parts.includes(m))
  return [...mods, key].join('+').toLowerCase()
}

const LABELS: Record<string, string> = {
  Control: 'Strg',
  Super: 'Win',
  Space: 'Leertaste',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Delete: 'Entf',
  Insert: 'Einfg',
  Home: 'Pos1',
  End: 'Ende',
  PageUp: 'Bild↑',
  PageDown: 'Bild↓',
  Enter: 'Enter',
  Backspace: 'Rück'
}

/** Display form, e.g. "Strg+Shift+Leertaste". */
export function formatAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((p) => LABELS[p] ?? (p.startsWith('num') ? 'Num ' + p.slice(3) : p))
    .join('+')
}
