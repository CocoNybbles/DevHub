import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { matchesAccelerator } from '../../../shared/hotkeys'

/**
 * Ein xterm-Terminal pro Agent, unabhängig von React.
 * Die Terminals leben so lange wie der Agent und sammeln Ausgabe auch dann,
 * wenn sie gerade nicht angezeigt werden. Beim Anzeigen wird ihr DOM-Element
 * in den jeweiligen Container (Einzelansicht oder Raster-Zelle) verschoben.
 */

interface Entry {
  term: Terminal
  fit: FitAddon
  host: HTMLDivElement
  opened: boolean
}

const entries = new Map<string, Entry>()

/** App-Kürzel, die das Terminal nicht verschlucken darf (z. B. Sprach-Aufnahme). */
let appHotkeys: string[] = []

export function setAppHotkeys(accelerators: string[]): void {
  appHotkeys = accelerators
}

const THEME = {
  background: '#16181d',
  foreground: '#d7dae0',
  cursor: '#d97757',
  selectionBackground: '#3a4150'
}

function ensure(id: string): Entry {
  let e = entries.get(id)
  if (e) return e

  const term = new Terminal({
    fontFamily: "'Cascadia Mono', Consolas, monospace",
    fontSize: 13,
    cursorBlink: true,
    scrollback: 5000,
    theme: THEME,
    allowProposedApi: false
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.onData((data) => window.api.agents.write(id, data))

  // Strg+Shift+C kopiert die Auswahl (Strg+C bleibt "Abbrechen" für den Agent)
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type === 'keydown' && ev.ctrlKey && ev.shiftKey && ev.code === 'KeyC') {
      const sel = term.getSelection()
      if (sel) navigator.clipboard.writeText(sel)
      return false
    }
    // App-Kürzel (Sprache) nicht ans Terminal weitergeben
    if (appHotkeys.some((h) => matchesAccelerator(ev, h))) return false
    return true
  })

  const host = document.createElement('div')
  host.className = 'xterm-host'
  e = { term, fit, host, opened: false }
  entries.set(id, e)
  return e
}

export function hasTerminal(id: string): boolean {
  return entries.has(id)
}

export function writeToTerminal(id: string, data: string): void {
  ensure(id).term.write(data)
}

function fitAndReport(id: string, e: Entry): void {
  if (!e.host.isConnected || e.host.clientWidth === 0 || e.host.clientHeight === 0) return
  try {
    e.fit.fit()
    window.api.agents.resize(id, e.term.cols, e.term.rows)
  } catch {
    // Container noch nicht gelayoutet
  }
}

/** Zeigt das Terminal des Agents im Container an; liefert eine Funktion zum Lösen. */
export function attachTerminal(id: string, container: HTMLElement): () => void {
  const e = ensure(id)
  container.appendChild(e.host)
  if (!e.opened) {
    e.term.open(e.host)
    e.opened = true
  }
  const ro = new ResizeObserver(() => fitAndReport(id, e))
  ro.observe(container)
  requestAnimationFrame(() => fitAndReport(id, e))

  return () => {
    ro.disconnect()
    if (e.host.parentElement === container) container.removeChild(e.host)
  }
}

export function focusTerminal(id: string): void {
  entries.get(id)?.term.focus()
}

export function disposeTerminal(id: string): void {
  const e = entries.get(id)
  if (!e) return
  e.host.remove()
  e.term.dispose()
  entries.delete(id)
}

export function terminalIds(): string[] {
  return [...entries.keys()]
}
