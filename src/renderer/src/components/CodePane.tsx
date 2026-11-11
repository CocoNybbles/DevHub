import { useEffect, useRef, useState } from 'react'
import type { CodeFocus, CodeSnippet } from '../../../shared/types'
import { languageForPath, monaco } from '../lib/monaco'
import { CodeIcon } from './Icons'
import SnippetList from './SnippetList'

interface Props {
  /** Code-Stelle aus `show_code` (null = keine) */
  focus: CodeFocus | null
  /** Code-Blöcke aus den Antworten des aktiven Agents, neueste zuerst */
  snippets: CodeSnippet[]
  /** Name des Agents, von dem Fokus/Snippets stammen */
  agentName?: string
  vscodeInstalled: boolean
}

type Tab = 'file' | 'snippets'

/**
 * Rechte Spalte (nur sichtbar, solange es etwas zu zeigen gibt):
 * „Datei“ = Stelle aus `show_code`, „Snippets“ = Code-Blöcke aus den Antworten mit Kopier-Button.
 * Gezeigt wird der zuletzt aktualisierte Reiter, bis der Nutzer selbst wechselt.
 */
function CodePane({ focus, snippets, agentName, vscodeInstalled }: Props): React.JSX.Element {
  const snippetsAt = snippets[0]?.at ?? 0
  const focusAt = focus?.at ?? 0
  /** Vom Nutzer gewählter Reiter – gilt, bis danach etwas Neues ankommt */
  const [chosen, setChosen] = useState<{ tab: Tab; at: number } | null>(null)
  const newest: Tab = snippetsAt > focusAt ? 'snippets' : 'file'
  let tab: Tab = chosen && chosen.at >= Math.max(snippetsAt, focusAt) ? chosen.tab : newest
  if (tab === 'file' && !focus) tab = 'snippets'
  if (tab === 'snippets' && !snippets.length) tab = 'file'
  const choose = (t: Tab): void => setChosen({ tab: t, at: Math.max(snippetsAt, focusAt) })

  const fileName = focus?.filePath.split(/[\\/]/).pop()

  return (
    <aside className="pane code">
      <header className="pane-header">
        <div className="tabs">
          {focus && (
            <button
              className={`tab ${tab === 'file' ? 'active' : ''}`}
              title={focus.filePath}
              onClick={() => choose('file')}
            >
              Datei
            </button>
          )}
          {snippets.length > 0 && (
            <button
              className={`tab ${tab === 'snippets' ? 'active' : ''}`}
              title="Code-Blöcke aus den Antworten des Agents"
              onClick={() => choose('snippets')}
            >
              Snippets <span className="count">{snippets.length}</span>
            </button>
          )}
        </div>
        {tab === 'file' && focus && vscodeInstalled && (
          <div className="header-actions">
            <button
              className="icon"
              title="In VS Code öffnen"
              onClick={() => window.api.code.openInVSCode(focus.filePath, focus.startLine)}
            >
              <CodeIcon />
            </button>
          </div>
        )}
      </header>

      {focus && (
        // Bleibt beim Reiterwechsel erhalten (Editor nicht neu aufbauen)
        <div className="code-file-view" style={tab === 'file' ? undefined : { display: 'none' }}>
          <div className="code-note">
            <span className="code-file" title={focus.filePath}>
              {fileName} · Z. {focus.startLine}
              {focus.endLine !== focus.startLine ? `–${focus.endLine}` : ''}
            </span>
            {(focus.note || agentName) && (
              <div>
                {agentName && <strong>{agentName}: </strong>}
                {focus.note}
              </div>
            )}
          </div>
          <FileView focus={focus} />
        </div>
      )}
      {tab === 'snippets' && <SnippetList snippets={snippets} />}
    </aside>
  )
}

/** Monaco (schreibgeschützt) mit hervorgehobener Stelle */
function FileView({ focus }: { focus: CodeFocus }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const decoRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    let cancelled = false
    window.api.code.readFile(focus.filePath).then((res) => {
      if (cancelled) return
      if (!res.ok) {
        setError(res.error)
        return
      }
      setError(null)
      const old = editor.getModel()
      editor.setModel(monaco.editor.createModel(res.content, languageForPath(focus.filePath)))
      old?.dispose()

      const lines = editor.getModel()!.getLineCount()
      const start = Math.min(focus.startLine, lines)
      const end = Math.min(Math.max(focus.endLine, start), lines)
      decoRef.current?.set([
        {
          range: new monaco.Range(start, 1, end, 1),
          options: {
            isWholeLine: true,
            className: 'code-hl-line',
            linesDecorationsClassName: 'code-hl-gutter',
            overviewRuler: { color: '#d97757', position: monaco.editor.OverviewRulerLane.Full }
          }
        }
      ])
      editor.revealLinesInCenter(start, end)
    })
    return () => {
      cancelled = true
    }
  }, [focus])

  return (
    <>
      {error && <div className="code-note error">{error}</div>}
      <div className="code-editor" ref={hostRef} />
    </>
  )
}

export default CodePane
