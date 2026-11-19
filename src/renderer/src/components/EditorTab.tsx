import { useEffect, useMemo, useRef, useState } from 'react'
import type { Agent } from '../../../shared/types'
import TerminalView from './TerminalView'
import DictationButton from './DictationButton'
import { AttachIcon, CloseIcon, EditIcon, LockIcon, SendIcon } from './Icons'
import { attachmentRefs, attachmentToken, removeAttachment } from '../lib/editorText'
import { useT } from '../lib/i18n'

interface Props {
  agent: Agent
  projectName?: string
  draft: string
  onDraftChange: (text: string) => void
  /** text = new prompt (null = discard), submit = send */
  onFinish: (text: string | null, submit: boolean) => void
  onError: (message: string) => void
}

/**
 * Ctrl+G in the agent: tab in the center with the (locked) terminal on the left and a text field on the right.
 * The agent waits until the tab is closed; then claude takes the text as its prompt.
 * Images/files: paste (Ctrl+V), drop (drag & drop) or pick → `@"path"` in the text.
 */
function EditorTab(props: Props): React.JSX.Element {
  const { agent, draft, onDraftChange } = props
  const t = useT()
  const textarea = useRef<HTMLTextAreaElement>(null)
  /** Last cursor position (clicking buttons takes focus from the textarea); null = end */
  const caret = useRef<number | null>(null)
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  /** false = tab is open, but claude has not started the editor yet */
  const ready = !!agent.editing

  useEffect(() => {
    if (ready) textarea.current?.focus()
  }, [agent.id, ready])

  /** Insert text at the cursor position (with a space to the adjacent text) */
  const insert = (text: string): void => {
    const el = textarea.current
    const value = el?.value ?? draft
    const pos = Math.min(caret.current ?? value.length, value.length)
    const before = value.slice(0, pos)
    const after = value.slice(pos)
    const sepBefore = before && !/\s$/.test(before) ? ' ' : ''
    const sepAfter = after && !/^\s/.test(after) ? ' ' : ''
    const next = before + sepBefore + text + sepAfter + after
    const end = (before + sepBefore + text + sepAfter).length
    onDraftChange(next)
    caret.current = end
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(end, end)
    })
  }

  const saveImage = async (blob: Blob): Promise<void> => {
    try {
      const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
      const path = await window.api.editor.saveImage(agent.id, ext, await blob.arrayBuffer())
      insert(attachmentToken(path))
    } catch (e) {
      props.onError(String(e))
    }
  }

  const onPaste = (e: React.ClipboardEvent): void => {
    const images = [...e.clipboardData.items].filter(
      (i) => i.kind === 'file' && i.type.startsWith('image/')
    )
    if (!images.length) return
    e.preventDefault()
    for (const item of images) {
      const file = item.getAsFile()
      if (file) void saveImage(file)
    }
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    for (const file of [...e.dataTransfer.files]) {
      const path = window.api.editor.pathForFile(file)
      if (path) insert(attachmentToken(path))
      else if (file.type.startsWith('image/')) void saveImage(file) // e.g. from the browser
    }
  }

  const pickFiles = async (): Promise<void> => {
    const paths = await window.api.editor.pickFiles()
    if (paths.length) insert(paths.map(attachmentToken).join(' '))
  }

  const refs = useMemo(() => attachmentRefs(draft), [draft])

  return (
    <main className="pane center editor-tab">
      <header className="pane-header">
        <span className="title">
          <EditIcon />
          {t('editor.title', { name: agent.name })}
          {props.projectName && <span className="muted"> · {props.projectName}</span>}
          <span className="muted editor-lock-note" title={t('editor.terminalLockedTooltip')}>
            <LockIcon size={11} /> {t('editor.terminalLocked')}
          </span>
        </span>
        <div className="header-actions">
          <button
            className="icon"
            title={t('editor.closeTooltip')}
            onClick={() => props.onFinish(draft, false)}
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      <div className="editor-split">
        {/* Terminal at original size, scaled down if needed (see terminals.ts) */}
        <section className="editor-terminal">
          <TerminalView agentId={agent.id} />
        </section>

        <section
          className={`editor-panel ${dragOver ? 'drag-over' : ''}`}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div className="dictation-field editor-field">
            <textarea
              ref={textarea}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onSelect={(e) => (caret.current = e.currentTarget.selectionStart)}
              onPaste={onPaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  props.onFinish(draft, true)
                }
              }}
              placeholder={ready ? t('editor.placeholder') : t('editor.placeholderOpening')}
              disabled={!ready}
              spellCheck={false}
            />
            <DictationButton onText={insert} onStatus={setStatus} />
          </div>
          <small className={`dictation-status ${status?.error ? 'error' : 'muted'}`}>
            {status?.text}
          </small>

          {refs.length > 0 && (
            <div className="attachments">
              {refs.map((path) => (
                <Attachment
                  key={path}
                  path={path}
                  onRemove={() => onDraftChange(removeAttachment(draft, path))}
                />
              ))}
            </div>
          )}

          <div className="editor-actions">
            <button
              className="secondary"
              title={t('editor.attachTooltip')}
              disabled={!ready}
              onClick={pickFiles}
            >
              <AttachIcon /> {t('editor.attach')}
            </button>
            <span className="spacer" />
            <button
              className="secondary"
              title={t('editor.discardTooltip')}
              onClick={() => props.onFinish(null, false)}
            >
              {t('common.discard')}
            </button>
            <button
              className="secondary"
              title={t('editor.applyTooltip')}
              disabled={!ready}
              onClick={() => props.onFinish(draft, false)}
            >
              {t('editor.applyToPrompt')}
            </button>
            <button
              className="primary"
              title={t('editor.sendTooltip')}
              disabled={!ready || !draft.trim()}
              onClick={() => props.onFinish(draft, true)}
            >
              <SendIcon /> {t('common.send')}
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}

/** Attached file: thumbnail (for images) + name, removable */
function Attachment({ path, onRemove }: { path: string; onRemove: () => void }): React.JSX.Element {
  const t = useT()
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    window.api.editor.imagePreview(path).then((url) => !cancelled && setPreview(url))
    return () => {
      cancelled = true
    }
  }, [path])
  const name = path.split(/[\\/]/).pop()
  return (
    <div className="attachment" title={path}>
      {preview ? <img src={preview} alt="" /> : <AttachIcon />}
      <span className="attachment-name">{name}</span>
      <button className="icon" title={t('common.remove')} onClick={onRemove}>
        <CloseIcon />
      </button>
    </div>
  )
}

export default EditorTab
