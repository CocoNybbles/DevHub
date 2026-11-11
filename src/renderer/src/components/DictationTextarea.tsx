import { useRef, useState } from 'react'
import DictationButton from './DictationButton'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Mindesthöhe in px (Standard aus CSS: 180) */
  minHeight?: number
}

/** Mehrzeiliges Textfeld mit Mikrofon-Button: diktierter Text wird an der Cursorposition eingefügt. */
function DictationTextarea({ value, onChange, placeholder, minHeight }: Props): React.JSX.Element {
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  /** Letzte Cursorposition (der Klick aufs Mikrofon nimmt der Textarea den Fokus); null = Ende */
  const caret = useRef<number | null>(null)

  const insertText = (text: string): void => {
    const el = textarea.current
    const pos = Math.min(caret.current ?? value.length, value.length)
    const before = value.slice(0, pos)
    const sep = before && !/\s$/.test(before) ? ' ' : ''
    const end = (before + sep + text).length
    onChange(before + sep + text + value.slice(pos))
    caret.current = end
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(end, end)
    })
  }

  return (
    <>
      <div className="dictation-field">
        <textarea
          ref={textarea}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onSelect={(e) => (caret.current = e.currentTarget.selectionStart)}
          placeholder={placeholder}
          spellCheck={false}
          style={minHeight ? { minHeight } : undefined}
        />
        <DictationButton onText={insertText} onStatus={setStatus} />
      </div>
      <small className={`dictation-status ${status?.error ? 'error' : 'muted'}`}>
        {status?.text}
      </small>
    </>
  )
}

export default DictationTextarea
