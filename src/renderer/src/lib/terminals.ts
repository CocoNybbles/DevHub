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
  /** Größe (px) beim letzten Anpassen – so groß kennt claude das Terminal */
  lastSize: { w: number; h: number } | null
  /**
   * Gesperrt (Editor-Tab offen): claude wartet blockierend auf den Editor und kann nicht neu
   * zeichnen. Eine Größenänderung würde den Inhalt abschneiden → Größe bleibt fest, in kleineren
   * Containern wird das Terminal stattdessen verkleinert dargestellt (CSS-Skalierung).
   */
  lockedSize: { w: number; h: number } | null
}

const entries = new Map<string, Entry>()

/**
 * Strg+G an claude schicken: „Prompt im Editor bearbeiten“. claude startet dann seinen Editor
 * (= DevHubs Editor-Tab, s. AgentManager) und zeigt „Save and close editor to continue…“.
 */
export function sendEditorKey(id: string): void {
  window.api.agents.write(id, '\x07')
}

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
  e = { term, fit, host, opened: false, lastSize: null, lockedSize: null }
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
    e.lastSize = { w: e.host.clientWidth, h: e.host.clientHeight }
    window.api.agents.resize(id, e.term.cols, e.term.rows)
  } catch {
    // Container noch nicht gelayoutet
  }
}

/** Größe anpassen – bzw. bei gesperrtem Terminal feste Größe, passend skaliert */
function layout(id: string, e: Entry): void {
  const container = e.host.parentElement
  if (!e.lockedSize || !container) return fitAndReport(id, e)
  const { w, h } = e.lockedSize
  const scale = Math.min(1, container.clientWidth / w, container.clientHeight / h)
  Object.assign(e.host.style, {
    width: `${w}px`,
    height: `${h}px`,
    transformOrigin: '0 0',
    transform: scale > 0 && scale < 1 ? `scale(${scale})` : ''
  })
}

/** Zeigt das Terminal des Agents im Container an; liefert eine Funktion zum Lösen. */
export function attachTerminal(id: string, container: HTMLElement): () => void {
  const e = ensure(id)
  container.appendChild(e.host)
  if (!e.opened) {
    e.term.open(e.host)
    e.opened = true
  }
  const ro = new ResizeObserver(() => layout(id, e))
  ro.observe(container)
  requestAnimationFrame(() => layout(id, e))

  return () => {
    ro.disconnect()
    if (e.host.parentElement === container) container.removeChild(e.host)
  }
}

/**
 * Standbilder für die Agents-Ansicht, solange der Editor-Tab offen ist: claude kann nur in einer
 * Größe zeichnen, und das live-Terminal hängt dann (schmaler) im Tab. Vor dem Umhängen wird die
 * Ansicht in voller Breite als DOM-Kopie festgehalten (xterm zeichnet per DOM; Farben/Maße hängen
 * an der Klasse am Wurzelelement, die Kopie sieht daher gleich aus).
 */
const snapshots = new Map<string, { node: HTMLElement; w: number; h: number }>()

export function snapshotTerminal(id: string): void {
  const e = entries.get(id)
  const root = e?.host.querySelector<HTMLElement>('.xterm')
  if (!e || !root || !e.host.isConnected || e.host.clientWidth === 0) return
  const node = root.cloneNode(true) as HTMLElement
  node.querySelectorAll('textarea').forEach((t) => t.remove()) // keine Eingabe/Fokus
  node.setAttribute('inert', '')
  snapshots.set(id, { node, w: e.host.clientWidth, h: e.host.clientHeight })
}

export function hasSnapshot(id: string): boolean {
  return snapshots.has(id)
}

export function dropSnapshot(id: string): void {
  snapshots.get(id)?.node.remove()
  snapshots.delete(id)
}

/** Standbild im Container zeigen (in Originalgröße, in kleineren Containern verkleinert). */
export function attachSnapshot(id: string, container: HTMLElement): () => void {
  const s = snapshots.get(id)
  if (!s) return () => {}
  const wrap = document.createElement('div')
  wrap.className = 'xterm-host'
  wrap.appendChild(s.node)
  container.appendChild(wrap)
  const place = (): void => {
    const scale = Math.min(1, container.clientWidth / s.w, container.clientHeight / s.h)
    Object.assign(wrap.style, {
      width: `${s.w}px`,
      height: `${s.h}px`,
      transformOrigin: '0 0',
      transform: scale > 0 && scale < 1 ? `scale(${scale})` : ''
    })
  }
  const ro = new ResizeObserver(place)
  ro.observe(container)
  place()
  return () => {
    ro.disconnect()
    wrap.remove()
  }
}

/**
 * Editor-Tab offen: Eingaben sperren und Größe einfrieren (s. `lockedSize`); beim Entsperren
 * wieder an den Container anpassen – claude zeichnet dann in der neuen Größe neu.
 * Muss gesperrt werden, bevor sich die Ansicht ändert (Workspace: beim Ereignis `editor:opened`).
 */
export function setTerminalLocked(id: string, locked: boolean): void {
  const e = entries.get(id)
  if (!e) return
  e.term.options.disableStdin = locked
  if (locked && !e.lockedSize) {
    const connected = e.host.isConnected && e.host.clientWidth > 0
    e.lockedSize = connected ? { w: e.host.clientWidth, h: e.host.clientHeight } : e.lastSize
    if (e.lockedSize) layout(id, e)
  } else if (!locked && e.lockedSize) {
    e.lockedSize = null
    Object.assign(e.host.style, { width: '', height: '', transform: '', transformOrigin: '' })
    requestAnimationFrame(() => layout(id, e))
  }
}

export function focusTerminal(id: string): void {
  entries.get(id)?.term.focus()
}

export function disposeTerminal(id: string): void {
  dropSnapshot(id)
  const e = entries.get(id)
  if (!e) return
  e.host.remove()
  e.term.dispose()
  entries.delete(id)
}

export function terminalIds(): string[] {
  return [...entries.keys()]
}
