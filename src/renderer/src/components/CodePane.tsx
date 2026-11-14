import { useEffect, useRef, useState } from 'react'
import type {
  ActivityEntry,
  Agent,
  CodeFocus,
  CodePlan,
  CodeSnippet,
  EditedFile,
  LineRange
} from '../../../shared/types'
import { languageForPath, monaco } from '../lib/monaco'
import { fileTabKey } from '../lib/codeTabs'
import { getLocale, type TFunction } from '../../../shared/i18n'
import { useT } from '../lib/i18n'
import { CloseIcon, CodeIcon } from './Icons'
import SnippetList from './SnippetList'
import Markdown from './Markdown'

interface Props {
  /** Code location from `show_code` (null = none); the Workspace filters out closed tabs */
  focus: CodeFocus | null
  /** Code blocks from the active agent's replies, newest first */
  snippets: CodeSnippet[]
  /** Files edited by the active agent (order = first edit) */
  edits: EditedFile[]
  /** Name of the agent the focus came from */
  agentName?: string
  /** Name of the active agent (snippets, edited files) */
  editsAgentName?: string
  vscodeInstalled: boolean
  /** Close a tab (key from lib/codeTabs, version); reappears with newer content */
  onCloseTab: (key: string, at: number) => void
  /** Key of the snippets tab (per agent) */
  snippetsKey: string
  /** Plan shown by the agent (MCP `show_plan`), null = none or closed */
  plan: CodePlan | null
  planKey: string
  /** Active agent: "Activity" tab with its latest steps */
  activityAgent?: Agent
}

/** The agent's latest steps (tool calls); reloads as soon as it does something new */
function ActivityList({ agent }: { agent: Agent }): React.JSX.Element {
  const t = useT()
  const [log, setLog] = useState<ActivityEntry[]>([])
  const stamp = `${agent.id}|${agent.activity ?? ''}|${agent.status}`
  useEffect(() => {
    let cancelled = false
    window.api.agents.activityLog(agent.id).then((list) => !cancelled && setLog(list))
    return () => {
      cancelled = true
    }
  }, [agent.id, stamp])
  return (
    <div className="activity-list">
      {log.length === 0 && <div className="muted activity-empty">{t('code.activityEmpty')}</div>}
      {log.map((e, i) => (
        <div key={`${e.at}-${i}`} className="activity-item">
          <span className="muted">
            {new Date(e.at).toLocaleTimeString(getLocale(), {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })}
          </span>
          <span className="activity-text">{e.text}</span>
        </div>
      ))}
    </div>
  )
}

/** A file tab: edited file and/or location from `show_code` */
interface FileTab {
  key: string
  filePath: string
  at: number
  ranges: LineRange[]
  /** Note from `show_code` (only if the focus is the newest information about the file) */
  focus?: CodeFocus
  edit?: EditedFile
}

const SNIPPETS = 'snippets'
const PLAN = 'plan'
const ACTIVITY = 'activity'
const fileKey = fileTabKey
const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/** Width of the code column (splitter), remembered per machine in the data folder (localStorage) */
const WIDTH_KEY = 'devhub.codePaneWidth'
const DEFAULT_WIDTH = 420
const MIN_WIDTH = 240
/** Minimum space kept for list + terminal */
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
    // not important
  }
}

/**
 * Right column (only visible while there is something to show): one tab per edited file or file from
 * `show_code` (changed lines highlighted), plus "Snippets" = code blocks from the replies.
 * The most recently updated tab is shown until the user switches manually.
 * A splitter on the left adjusts the width.
 */
function CodePane({
  focus,
  snippets,
  edits,
  agentName,
  editsAgentName,
  vscodeInstalled,
  onCloseTab,
  snippetsKey,
  plan,
  planKey,
  activityAgent
}: Props): React.JSX.Element {
  const t = useT()
  // ---- Assemble tabs
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
      // Shown location first (like the former "File" tab)
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

  const visible = files

  const snippetsAt = snippets[0]?.at ?? 0
  const all = [
    ...visible.map((f) => ({ key: f.key, at: f.at })),
    ...(plan ? [{ key: PLAN, at: plan.at }] : []),
    ...(snippets.length ? [{ key: SNIPPETS, at: snippetsAt }] : []),
    // Activity never comes to the front by itself (at = 0), but stays selectable
    ...(activityAgent ? [{ key: ACTIVITY, at: 0 }] : [])
  ]
  const latest = Math.max(0, ...all.map((t) => t.at))
  const newest = all.reduce<{ key: string; at: number } | null>(
    (best, t) => (!best || t.at > best.at ? t : best),
    null
  )?.key

  /** Tab chosen by the user – applies until something new arrives afterwards */
  const [chosen, setChosen] = useState<{ key: string; at: number } | null>(null)
  let tab =
    chosen && chosen.at >= latest && all.some((t) => t.key === chosen.key) ? chosen.key : newest
  if (!tab) tab = SNIPPETS
  const choose = (key: string): void => setChosen({ key, at: latest })
  const current = visible.find((f) => f.key === tab)

  /** Close a tab; if it was the last one, the Workspace hides the column */
  const closeTab = (key: string, at: number): void => {
    if (tab === key) {
      // Select the neighboring tab
      const i = all.findIndex((t) => t.key === key)
      const next = all[i + 1] ?? all[i - 1]
      if (next) setChosen({ key: next.key, at: latest })
    }
    onCloseTab(key === SNIPPETS ? snippetsKey : key === PLAN ? planKey : key, at)
  }
  const close = (f: FileTab): void => closeTab(f.key, f.at)

  // Keep the active tab visible in the tab bar
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
      // In a small window, never wider than the space left beside list + terminal
      style={{ width: `min(${width}px, calc(100vw - ${MIN_REST}px))` }}
    >
      <div
        className="pane-splitter"
        title={t('code.splitterTooltip')}
        onPointerDown={startDrag}
        onDoubleClick={resetWidth}
      />
      <header className="pane-header">
        <div className="tabs" ref={tabsRef}>
          {visible.map((f) => (
            <div
              key={f.key}
              className={`tab file-tab ${tab === f.key ? 'active' : ''}`}
              title={tabTitle(f, t)}
              onClick={() => choose(f.key)}
              onAuxClick={(e) => e.button === 1 && close(f)}
            >
              {f.edit && <span className={`edit-dot ${f.edit.created ? 'created' : ''}`} />}
              <span className="file-tab-name">{baseName(f.filePath)}</span>
              <button
                className="icon"
                title={t('code.closeFileTab')}
                onClick={(e) => {
                  e.stopPropagation()
                  close(f)
                }}
              >
                <CloseIcon size={9} />
              </button>
            </div>
          ))}
          {plan && (
            <div
              className={`tab closable-tab ${tab === PLAN ? 'active' : ''}`}
              title={t('code.planTooltip', { title: plan.title })}
              onClick={() => choose(PLAN)}
              onAuxClick={(e) => e.button === 1 && closeTab(PLAN, plan.at)}
            >
              <span className="file-tab-name">{plan.title}</span>
              <button
                className="icon"
                title={t('code.closePlanTab')}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(PLAN, plan.at)
                }}
              >
                <CloseIcon size={9} />
              </button>
            </div>
          )}
          {activityAgent && (
            <div
              className={`tab ${tab === ACTIVITY ? 'active' : ''}`}
              title={t('code.activityTooltip', { name: activityAgent.name })}
              onClick={() => choose(ACTIVITY)}
            >
              {t('code.activity')}
            </div>
          )}
          {snippets.length > 0 && (
            <div
              className={`tab closable-tab ${tab === SNIPPETS ? 'active' : ''}`}
              title={t('code.snippetsTooltip')}
              onClick={() => choose(SNIPPETS)}
              onAuxClick={(e) => e.button === 1 && closeTab(SNIPPETS, snippetsAt)}
            >
              {t('code.snippets')} <span className="count">{snippets.length}</span>
              <button
                className="icon"
                title={t('code.closeSnippetsTab')}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(SNIPPETS, snippetsAt)
                }}
              >
                <CloseIcon size={9} />
              </button>
            </div>
          )}
        </div>
        {current && vscodeInstalled && (
          <div className="header-actions">
            <button
              className="icon"
              title={t('code.openInVSCode')}
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
        // Kept when switching tabs (don't rebuild the editor)
        <div className="code-file-view" style={current ? undefined : { display: 'none' }}>
          {current && (
            <div className="code-note">
              <span className="code-file" title={current.filePath}>
                {current.filePath}
              </span>
              <div>{describe(current, t, current.focus ? agentName : editsAgentName)}</div>
            </div>
          )}
          {current && (
            <FileView filePath={current.filePath} ranges={current.ranges} at={current.at} />
          )}
        </div>
      )}
      {tab === PLAN && plan && (
        <div className="plan-view">
          <Markdown text={plan.markdown} />
        </div>
      )}
      {tab === ACTIVITY && activityAgent && <ActivityList agent={activityAgent} />}
      {tab === SNIPPETS && <SnippetList snippets={snippets} />}
    </aside>
  )
}

function tabTitle(f: FileTab, t: TFunction): string {
  if (f.focus) return `${f.filePath}\n${t('code.shownByAgent')}`
  return `${f.filePath}\n${f.edit?.created ? t('code.createdByAgent') : t('code.editedByAgent')}`
}

const time = (at: number): string =>
  new Date(at).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' })

function linesText(ranges: LineRange[], t: TFunction): string {
  if (!ranges.length) return ''
  const parts = ranges.slice(0, 4).map((r) => (r.end > r.start ? `${r.start}–${r.end}` : r.start))
  return t('code.lines', { lines: `${parts.join(', ')}${ranges.length > 4 ? ' …' : ''}` })
}

/** Line below the path: who, what, when */
function describe(f: FileTab, t: TFunction, name?: string): React.ReactNode {
  const who = name ? <strong>{name}: </strong> : null
  if (f.focus) {
    return (
      <>
        {who}
        {linesText(f.ranges, t)}
        {f.focus.note ? ` · ${f.focus.note}` : ''}
      </>
    )
  }
  const lines = linesText(f.ranges, t)
  return (
    <>
      {who}
      {t(f.edit?.created ? 'code.createdAt' : 'code.editedAt', { time: time(f.at) })}
      {lines && ` · ${lines}`}
    </>
  )
}

/** Monaco (read-only) with highlighted lines; reloads when `at` changes */
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
  // Compare ranges by value only (the array is rebuilt on every render)
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
