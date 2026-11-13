import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { matchesAccelerator } from '../../../shared/hotkeys'

/**
 * One xterm terminal per agent, independent of React.
 * The terminals live as long as the agent and keep collecting output even
 * while they are not displayed. When shown, their DOM element is moved
 * into the respective container (single view or grid cell).
 */

interface Entry {
  term: Terminal
  fit: FitAddon
  host: HTMLDivElement
  opened: boolean
  /** Size (px) at the last fit – the size claude knows the terminal to have */
  lastSize: { w: number; h: number } | null
  /**
   * Locked (editor tab open): claude blocks waiting for the editor and cannot redraw.
   * A resize would cut off the content → the size stays fixed; in smaller containers
   * the terminal is shown scaled down instead (CSS scaling).
   */
  lockedSize: { w: number; h: number } | null
  /** Team worker: observe only (no input, independent of the editor lock) */
  readOnly: boolean
  /** Editor tab open */
  locked: boolean
}

const entries = new Map<string, Entry>()

/**
 * Send Ctrl+G to claude: "edit prompt in editor". claude then starts its editor
 * (= DevHub's editor tab, see AgentManager) and shows "Save and close editor to continue…".
 */
export function sendEditorKey(id: string): void {
  window.api.agents.write(id, '\x07')
}

/** App hotkeys the terminal must not swallow (e.g. voice recording). */
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

  // Copy/paste like in Windows Terminal (xterm.js itself only sends ^V on Ctrl+V)
  term.attachCustomKeyEventHandler((ev) => {
    const key = clipboardKey(ev)
    if (key === 'copy' && term.hasSelection()) {
      // Ctrl+C with a selection = copy; without a selection it stays "interrupt" for the agent
      ev.preventDefault()
      if (ev.type === 'keydown') {
        window.api.clipboard.writeText(term.getSelection()).catch(() => {})
        term.clearSelection()
      }
      return false
    }
    if (key === 'paste') {
      // Suppress the browser's default paste, otherwise the text would arrive twice
      ev.preventDefault()
      if (ev.type === 'keydown') pasteInto(id, term)
      return false
    }
    // Do not pass app hotkeys (voice) to the terminal
    if (appHotkeys.some((h) => matchesAccelerator(ev, h))) return false
    return true
  })

  const host = document.createElement('div')
  host.className = 'xterm-host'
  e = {
    term,
    fit,
    host,
    opened: false,
    lastSize: null,
    lockedSize: null,
    readOnly: false,
    locked: false
  }
  entries.set(id, e)
  return e
}

/** Ctrl+C / Ctrl+Shift+C / Ctrl+Insert = copy, Ctrl+V / Ctrl+Shift+V / Shift+Insert = paste */
function clipboardKey(ev: KeyboardEvent): 'copy' | 'paste' | null {
  if (ev.altKey || ev.metaKey) return null
  if (ev.ctrlKey && ev.code === 'KeyC') return 'copy'
  if (ev.ctrlKey && !ev.shiftKey && ev.code === 'Insert') return 'copy'
  if (ev.ctrlKey && ev.code === 'KeyV') return 'paste'
  if (ev.shiftKey && !ev.ctrlKey && ev.code === 'Insert') return 'paste'
  return null
}

/**
 * Clipboard into the terminal: text via `term.paste` (bracketed paste, multi-line = one block).
 * Only an image → Alt+V to claude, which on Windows uses it to attach an image from the clipboard
 * itself (Ctrl+V is reserved for the terminal there).
 */
function pasteInto(id: string, term: Terminal): void {
  if (term.options.disableStdin) return // locked or observe-only
  window.api.clipboard
    .read()
    .then(({ text, hasImage }) => {
      if (text) term.paste(text)
      else if (hasImage) window.api.agents.write(id, '\x1bv')
    })
    .catch(() => {})
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
    // container not laid out yet
  }
}

/** Fit the size – or, for a locked terminal, keep the fixed size, scaled to fit */
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

/** Shows the agent's terminal in the container; returns a function to detach it. */
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
 * Still images for the agents view while the editor tab is open: claude can only draw at one
 * size, and the live terminal then sits (narrower) in the tab. Before moving it, the full-width
 * view is captured as a DOM copy (xterm renders via DOM; colors/dimensions hang off the class
 * on the root element, so the copy looks identical).
 */
const snapshots = new Map<string, { node: HTMLElement; w: number; h: number }>()

export function snapshotTerminal(id: string): void {
  const e = entries.get(id)
  const root = e?.host.querySelector<HTMLElement>('.xterm')
  if (!e || !root || !e.host.isConnected || e.host.clientWidth === 0) return
  const node = root.cloneNode(true) as HTMLElement
  node.querySelectorAll('textarea').forEach((t) => t.remove()) // no input/focus
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

/** Show the still image in the container (at original size, scaled down in smaller containers). */
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
 * Editor tab open: block input and freeze the size (see `lockedSize`); on unlock, fit to the
 * container again – claude then redraws at the new size.
 * Must be locked before the view changes (Workspace: on the `editor:opened` event).
 */
export function setTerminalLocked(id: string, locked: boolean): void {
  const e = entries.get(id)
  if (!e) return
  e.locked = locked
  e.term.options.disableStdin = locked || e.readOnly
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

/** Team worker: terminal for observing only (selecting/copying still works, typing does not) */
export function setTerminalReadOnly(id: string, readOnly: boolean): void {
  const e = ensure(id)
  e.readOnly = readOnly
  e.term.options.disableStdin = e.locked || readOnly
  e.term.options.cursorBlink = !readOnly
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
