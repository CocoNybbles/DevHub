import { useEffect, useRef, useState } from 'react'
// Schlanker Import: Editor-Kern + Syntax-Hervorhebung (ohne TS/JSON/CSS/HTML-Sprachdienste)
import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/basic-languages/monaco.contribution'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import type { CodeFocus } from '../../../shared/types'
import { CodeIcon } from './Icons'

// Nur der Basis-Worker: Ansicht ist schreibgeschützt, Syntax-Hervorhebung braucht keine Sprach-Worker
self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

interface Props {
  focus: CodeFocus
  agentName?: string
  vscodeInstalled: boolean
}

function languageFor(path: string): string {
  const ext = '.' + (path.split('.').pop() ?? '').toLowerCase()
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  const lang = monaco.languages
    .getLanguages()
    .find((l) => l.extensions?.includes(ext) || l.filenames?.some((f) => f.toLowerCase() === name))
  if (lang) return lang.id
  // JSON gehört nicht zu den Basis-Sprachen → JavaScript-Hervorhebung passt dafür gut
  if (['.json', '.jsonc', '.json5'].includes(ext)) return 'javascript'
  return 'plaintext'
}

/** Rechte Spalte (nur sichtbar, solange ein Fokus existiert): Datei aus `show_code` mit hervorgehobener Stelle. */
function CodePane({ focus, agentName, vscodeInstalled }: Props): React.JSX.Element {
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
      editor.setModel(monaco.editor.createModel(res.content, languageFor(focus.filePath)))
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

  const fileName = focus.filePath.split(/[\\/]/).pop()

  return (
    <aside className="pane code">
      <header className="pane-header">
        <span className="title" title={focus.filePath}>
          {fileName}
          <span className="muted">
            {' '}
            · Z. {focus.startLine}
            {focus.endLine !== focus.startLine ? `–${focus.endLine}` : ''}
          </span>
        </span>
        {vscodeInstalled && (
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

      {(focus.note || agentName) && (
        <div className="code-note">
          {agentName && <strong>{agentName}: </strong>}
          {focus.note}
        </div>
      )}
      {error && <div className="code-note error">{error}</div>}

      <div className="code-editor" ref={hostRef} />
    </aside>
  )
}

export default CodePane
