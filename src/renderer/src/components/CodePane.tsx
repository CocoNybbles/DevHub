import { useEffect, useRef, useState } from 'react'
import type { CodeFocus, CodeSnippet, EditedFile, LineRange } from '../../../shared/types'
import { languageForPath, monaco } from '../lib/monaco'
import { CloseIcon, CodeIcon } from './Icons'
import SnippetList from './SnippetList'

interface Props {
  /** Code-Stelle aus `show_code` (null = keine) */
  focus: CodeFocus | null
  /** Code-Blöcke aus den Antworten des aktiven Agents, neueste zuerst */
  snippets: CodeSnippet[]
  /** Vom aktiven Agent bearbeitete Dateien (Reihenfolge = erste Bearbeitung) */
  edits: EditedFile[]
  /** Name des Agents, von dem der Fokus stammt */
  agentName?: string
  /** Name des aktiven Agents (Snippets, bearbeitete Dateien) */
  editsAgentName?: string
  vscodeInstalled: boolean
}

/** Ein Datei-Reiter: bearbeitete Datei und/oder Stelle aus `show_code` */
interface FileTab {
  key: string
  filePath: string
  at: number
  ranges: LineRange[]
  /** Hinweis aus `show_code` (nur, wenn der Fokus die neueste Information zur Datei ist) */
  focus?: CodeFocus
  edit?: EditedFile
}

const SNIPPETS = 'snippets'
const fileKey = (path: string): string => 'file:' + path.toLowerCase()
const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/** Breite der Code-Spalte (Splitter), gemerkt pro Rechner im Datenordner (localStorage) */
const WIDTH_KEY = 'devhub.codePaneWidth'
const DEFAULT_WIDTH = 420
const MIN_WIDTH = 240
/** So viel Platz bleibt mindestens für Liste + Terminal */
const MIN_REST = 260 + 320

function loadWidth(): number {
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY))
    return w >= MIN_WIDTH ? w : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

function saveWidth(w: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(w)))
  } catch {
    // nicht wichtig
  }
}

/**
 * Rechte Spalte (nur sichtbar, solange es etwas zu zeigen gibt): je bearbeitete Datei bzw. Datei aus
 * `show_code` ein Reiter (geänderte Zeilen hervorgehoben), dazu „Snippets“ = Code-Blöcke aus den
 * Antworten. Gezeigt wird der zuletzt aktualisierte Reiter, bis der Nutzer selbst wechselt.
 * Links ein Splitter zum Anpassen der Breite.
 */
function CodePane({
  focus,
  snippets,
  edits,
  agentName,
  editsAgentName,
  vscodeInstalled
}: Props): React.JSX.Element {
  // ---- Reiter zusammenstellen
  const files: FileTab[] = edits.map((e) => ({
    key: fileKey(e.filePath),
    filePath: e.filePath,
    at: e.at,
    ranges: e.changedLines,
    edit: e
  }))
  if (focus) {
    const tab = files.find((f) => f.key === fileKey(focus.filePath))
    const range = { start: focus.startLine, end: focus.endLine }
    if (!tab) {
      // Gezeigte Stelle zuerst (wie früher der Reiter „Datei“)
      files.unshift({
        key: fileKey(focus.filePath),
        filePath: focus.filePath,
        at: focus.at,
        ranges: [range],
        focus
      })
    } else if (focus.at > tab.at) {
      Object.assign(tab, { at: focus.at, ranges: [range], focus })
    }
  }

  /** Vom Nutzer geschlossene Reiter (Schlüssel → Stand beim Schließen); neue Änderung → wieder da */
  const [closed, setClosed] = useState<Record<string, number>>({})
  const visible = files.filter((f) => !(closed[f.key] >= f.at))

  const snippetsAt = snippets[0]?.at ?? 0
  const all = [
    ...visible.map((f) => ({ key: f.key, at: f.at })),
    ...(snippets.length ? [{ key: SNIPPETS, at: snippetsAt }] : [])
  ]
  const latest = Math.max(0, ...all.map((t) => t.at))
  const newest = all.reduce<{ key: string; at: number } | null>(
    (best, t) => (!best || t.at > best.at ? t : best),
    null
  )?.key

  /** Vom Nutzer gewählter Reiter – gilt, bis danach etwas Neues ankommt */
  const [chosen, setChosen] = useState<{ key: string; at: number } | null>(null)
  let tab =
    chosen && chosen.at >= latest && all.some((t) => t.key === chosen.key) ? chosen.key : newest
  if (!tab) tab = SNIPPETS
  const choose = (key: string): void => setChosen({ key, at: latest })
  const current = visible.find((f) => f.key === tab)

  const close = (f: FileTab): void => {
    setClosed((c) => ({ ...c, [f.key]: f.at }))
    if (tab === f.key) {
      // Nachbarreiter wählen
      const i = all.findIndex((t) => t.key === f.key)
      const next = all[i + 1] ?? all[i - 1]
      if (next) setChosen({ key: next.key, at: latest })
    }
  }

  // Aktiven Reiter in der Leiste sichtbar halten
  const tabsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    tabsRef.current
      ?.querySelector('.tab.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [tab])

  // ---- Splitter
  const [width, setWidth] = useState(loadWidth)
  const [dragging, setDragging] = useState(false)
  const startDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    setDragging(true)
    const clamp = (w: number): number =>
      Math.max(MIN_WIDTH, Math.min(w, window.innerWidth - MIN_REST))
    let w = width
    let frame = 0
    const move = (ev: PointerEvent): void => {
      w = clamp(window.innerWidth - ev.clientX)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setWidth(w))
    }
    const up = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      cancelAnimationFrame(frame)
      setWidth(w)
      setDragging(false)
      saveWidth(w)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }
  const resetWidth = (): void => {
    setWidth(DEFAULT_WIDTH)
    saveWidth(DEFAULT_WIDTH)
  }

  return (
    <aside
      className={`pane code ${dragging ? 'resizing' : ''}`}
      // Bei kleinem Fenster nie breiter, als neben Liste + Terminal Platz ist
      style={{ width: `min(${width}px, calc(100vw - ${MIN_REST}px))` }}
    >
      <div
        className="pane-splitter"
        title="Breite ziehen · Doppelklick = Standardbreite"
        onPointerDown={startDrag}
        onDoubleClick={resetWidth}
      />
      <header className="pane-header">
        <div className="tabs" ref={tabsRef}>
          {visible.map((f) => (
            <div
              key={f.key}
              className={`tab file-tab ${tab === f.key ? 'active' : ''}`}
              title={tabTitle(f)}
              onClick={() => choose(f.key)}
              onAuxClick={(e) => e.button === 1 && close(f)}
            >
              {f.edit && <span className={`edit-dot ${f.edit.created ? 'created' : ''}`} />}
              <span className="file-tab-name">{baseName(f.filePath)}</span>
              <button
                className="icon"
                title="Reiter schließen (erscheint bei der nächsten Änderung wieder)"
                onClick={(e) => {
                  e.stopPropagation()
                  close(f)
                }}
              >
                <CloseIcon size={9} />
              </button>
            </div>
          ))}
          {snippets.length > 0 && (
            <button
              className={`tab ${tab === SNIPPETS ? 'active' : ''}`}
              title="Code-Blöcke aus den Antworten des Agents"
              onClick={() => choose(SNIPPETS)}
            >
              Snippets <span className="count">{snippets.length}</span>
            </button>
          )}
        </div>
        {current && vscodeInstalled && (
          <div className="header-actions">
            <button
              className="icon"
              title="In VS Code öffnen"
              onClick={() =>
                window.api.code.openInVSCode(current.filePath, current.ranges[0]?.start ?? 1)
              }
            >
              <CodeIcon />
            </button>
          </div>
        )}
      </header>

      {visible.length > 0 && (
        // Bleibt beim Reiterwechsel erhalten (Editor nicht neu aufbauen)
        <div className="code-file-view" style={current ? undefined : { display: 'none' }}>
          {current && (
            <div className="code-note">
              <span className="code-file" title={current.filePath}>
                {current.filePath}
              </span>
              <div>{describe(current, current.focus ? agentName : editsAgentName)}</div>
            </div>
          )}
          {current && (
            <FileView filePath={current.filePath} ranges={current.ranges} at={current.at} />
          )}
        </div>
      )}
      {tab === SNIPPETS && <SnippetList snippets={snippets} />}
    </aside>
  )
}

function tabTitle(f: FileTab): string {
  if (f.focus) return `${f.filePath}\nVom Agent gezeigt`
  return `${f.filePath}\n${f.edit?.created ? 'Vom Agent angelegt' : 'Vom Agent bearbeitet'}`
}

const time = (at: number): string =>
  new Date(at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

function linesText(ranges: LineRange[]): string {
  if (!ranges.length) return ''
  const parts = ranges.slice(0, 4).map((r) => (r.end > r.start ? `${r.start}–${r.end}` : r.start))
  return `Z. ${parts.join(', ')}${ranges.length > 4 ? ' …' : ''}`
}

/** Zeile unter dem Pfad: wer, was, wann */
function describe(f: FileTab, name?: string): React.ReactNode {
  const who = name ? <strong>{name}: </strong> : null
  if (f.focus) {
    return (
      <>
        {who}
        {linesText(f.ranges)}
        {f.focus.note ? ` · ${f.focus.note}` : ''}
      </>
    )
  }
  const what = f.edit?.created ? 'angelegt' : 'bearbeitet'
  const lines = linesText(f.ranges)
  return (
    <>
      {who}
      {what} um {time(f.at)}
      {lines && ` · ${lines}`}
    </>
  )
}

/** Monaco (schreibgeschützt) mit hervorgehobenen Zeilen; lädt neu, wenn sich `at` ändert */
function FileView({
  filePath,
  ranges,
  at
}: {
  filePath: string
  ranges: LineRange[]
  at: number
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const decoRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bereiche nur als Wert vergleichen (Array wird bei jedem Rendern neu gebaut)
  const rangesKey = JSON.stringify(ranges)

  useEffect(() => {
    if (!hostRef.current) return
    const editor = monaco.editor.create(hostRef.current, {
      readOnly: true,
      theme: 'vs-dark',
      automaticLayout: true,
      fontFamily: "'Cascadia Mono', Consolas, monospace",
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      glyphMargin: false
    })
    editorRef.current = editor
    decoRef.current = editor.createDecorationsCollection()
    return () => {
      editor.getModel()?.dispose()
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const wanted: LineRange[] = JSON.parse(rangesKey)
    let cancelled = false
    window.api.code.readFile(filePath).then((res) => {
      if (cancelled) return
      if (!res.ok) {
        setError(res.error)
        return
      }
      setError(null)
      const old = editor.getModel()
      editor.setModel(monaco.editor.createModel(res.content, languageForPath(filePath)))
      old?.dispose()

      const lines = editor.getModel()!.getLineCount()
      const clamped = wanted.map((r) => {
        const start = Math.min(Math.max(1, r.start), lines)
        return { start, end: Math.min(Math.max(r.end, start), lines) }
      })
      decoRef.current?.set(
        clamped.map((r) => ({
          range: new monaco.Range(r.start, 1, r.end, 1),
          options: {
            isWholeLine: true,
            className: 'code-hl-line',
            linesDecorationsClassName: 'code-hl-gutter',
            overviewRuler: { color: '#d97757', position: monaco.editor.OverviewRulerLane.Full }
          }
        }))
      )
      if (clamped.length) editor.revealLinesInCenter(clamped[0].start, clamped[0].end)
      else editor.setScrollTop(0)
    })
    return () => {
      cancelled = true
    }
  }, [filePath, rangesKey, at])

  return (
    <>
      {error && <div className="code-note error">{error}</div>}
      <div className="code-editor" ref={hostRef} />
    </>
  )
}

export default CodePane
