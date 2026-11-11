/**
 * Tastenkürzel im Electron-Accelerator-Format (z. B. "Control+Shift+Space").
 * Dasselbe Format nutzt der Hauptprozess für `globalShortcut` und der Renderer
 * für die In-App-Erkennung – daher hier gemeinsam.
 */

export const DEFAULT_HOTKEYS = {
  /** In der App: Sprach-Anweisung an den aktiven Agent */
  agentVoice: 'Control+Shift+Space',
  /** Systemweit: Agent per Name ansprechen / neuen Agent starten */
  globalVoice: 'Control+Alt+Space',
  /** In der App: Anweisung für den aktiven Agent im Editor-Tab schreiben */
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

/** Taste (ohne Modifier) aus `KeyboardEvent.code` – layoutunabhängig. */
function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return 'num' + code.slice(6)
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code
  return NAMED_KEYS[code] ?? null
}

type KeyLike = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>

/**
 * Accelerator aus einem Tastendruck, oder null, wenn er (noch) kein gültiges Kürzel ist:
 * reine Modifier-Taste, unbekannte Taste, oder ohne Strg/Alt/Win (außer F-Tasten).
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

/** Vergleicht einen Tastendruck mit einem Accelerator (Reihenfolge der Modifier egal). */
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

/** Anzeigeform, z. B. "Strg+Shift+Leertaste". */
export function formatAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((p) => LABELS[p] ?? (p.startsWith('num') ? 'Num ' + p.slice(3) : p))
    .join('+')
}
