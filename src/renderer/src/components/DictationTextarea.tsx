import { useRef, useState } from 'react'
import DictationButton from './DictationButton'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Minimum height in px (CSS default: 180) */
  minHeight?: number
}

/** Multi-line text field with microphone button: dictated text is inserted at the cursor position. */
function DictationTextarea({ value, onChange, placeholder, minHeight }: Props): React.JSX.Element {
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  /** Last cursor position (clicking the microphone takes focus from the textarea); null = end */
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
