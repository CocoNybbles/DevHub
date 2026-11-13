import { useEffect, useState } from 'react'
import type { CodeSnippet } from '../../../shared/types'
import { languageForFence, monaco } from '../lib/monaco'
import { CheckIcon, CopyIcon } from './Icons'

/** Code blocks from the agent's replies, newest first, each with a copy button. */
function SnippetList({ snippets }: { snippets: CodeSnippet[] }): React.JSX.Element {
  return (
    <div className="snippets">
      {snippets.map((s) => (
        <SnippetCard key={s.id} snippet={s} />
      ))}
    </div>
  )
}

function SnippetCard({ snippet }: { snippet: CodeSnippet }): React.JSX.Element {
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const lines = snippet.code.split('\n').length

  // Syntax highlighting via Monaco (without an editor instance)
  useEffect(() => {
    let cancelled = false
    monaco.editor
      .colorize(snippet.code, languageForFence(snippet.language), { tabSize: 4 })
      .then((h) => !cancelled && setHtml(h))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [snippet.code, snippet.language])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  // Via the main process: works regardless of window focus
  const copy = (): void => {
    window.api.clipboard.writeText(snippet.code).then(() => setCopied(true))
  }

  return (
    <div className="snippet">
      <div className="snippet-header">
        <span className="snippet-lang">{snippet.language || 'Text'}</span>
        <span className="muted">
          {lines} {lines === 1 ? 'Zeile' : 'Zeilen'} ·{' '}
          {new Date(snippet.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <button
          className={`snippet-copy ${copied ? 'done' : ''}`}
          title="In die Zwischenablage kopieren"
          onClick={copy}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Kopiert' : 'Kopieren'}
        </button>
      </div>
      {html ? (
        <pre className="snippet-code" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="snippet-code">{snippet.code}</pre>
      )}
    </div>
  )
}

export default SnippetList
