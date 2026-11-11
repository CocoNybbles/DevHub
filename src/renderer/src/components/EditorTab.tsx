import { useEffect, useMemo, useRef, useState } from 'react'
import type { Agent } from '../../../shared/types'
import TerminalView from './TerminalView'
import DictationButton from './DictationButton'
import { AttachIcon, CloseIcon, EditIcon, LockIcon, SendIcon } from './Icons'
import { attachmentRefs, attachmentToken, removeAttachment } from '../lib/editorText'

interface Props {
  agent: Agent
  projectName?: string
  draft: string
  onDraftChange: (text: string) => void
  /** text = neuer Prompt (null = verwerfen), submit = abschicken */
  onFinish: (text: string | null, submit: boolean) => void
  onError: (message: string) => void
}

/**
 * Strg+G im Agent: Tab in der Mitte mit dem (gesperrten) Terminal links und einem Textfeld rechts.
 * Der Agent wartet, bis der Tab geschlossen wird; dann übernimmt claude den Text als Prompt.
 * Bilder/Dateien: einfügen (Strg+V), ablegen (Drag & Drop) oder auswählen → `@"pfad"` im Text.
 */
function EditorTab(props: Props): React.JSX.Element {
  const { agent, draft, onDraftChange } = props
  const textarea = useRef<HTMLTextAreaElement>(null)
  /** Letzte Cursorposition (Klick auf Buttons nimmt der Textarea den Fokus); null = Ende */
  const caret = useRef<number | null>(null)
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  /** false = Tab ist offen, claude hat den Editor aber noch nicht gestartet */
  const ready = !!agent.editing

  useEffect(() => {
    if (ready) textarea.current?.focus()
  }, [agent.id, ready])

  /** Text an der Cursorposition einfügen (mit Leerzeichen zum Nachbartext) */
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
      else if (file.type.startsWith('image/')) void saveImage(file) // z. B. aus dem Browser
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
          Anweisung für {agent.name}
          {props.projectName && <span className="muted"> · {props.projectName}</span>}
          <span
            className="muted editor-lock-note"
            title="Der Agent wartet, bis dieser Tab geschlossen wird"
          >
            <LockIcon size={11} /> Terminal gesperrt
          </span>
        </span>
        <div className="header-actions">
          <button
            className="icon"
            title="Tab schließen – Text in den Prompt übernehmen, ohne abzuschicken"
            onClick={() => props.onFinish(draft, false)}
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      <div className="editor-split">
        {/* Terminal in Originalgröße, bei Bedarf verkleinert dargestellt (s. terminals.ts) */}
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
              placeholder={
                ready
                  ? 'Anweisung eingeben oder diktieren …\n\nBilder: Strg+V, hierher ziehen oder 📎 – sie werden als @"pfad" angehängt.\nStrg+Enter schickt ab.'
                  : 'Editor wird geöffnet …'
              }
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
              title="Bilder oder Dateien anhängen"
              disabled={!ready}
              onClick={pickFiles}
            >
              <AttachIcon /> Anhängen
            </button>
            <span className="spacer" />
            <button
              className="secondary"
              title="Änderungen verwerfen – der Prompt bleibt wie vor Strg+G"
              onClick={() => props.onFinish(null, false)}
            >
              Verwerfen
            </button>
            <button
              className="secondary"
              title="Text in den Prompt des Agents übernehmen, ohne abzuschicken"
              disabled={!ready}
              onClick={() => props.onFinish(draft, false)}
            >
              In Prompt übernehmen
            </button>
            <button
              className="primary"
              title="Übernehmen und abschicken (Strg+Enter)"
              disabled={!ready || !draft.trim()}
              onClick={() => props.onFinish(draft, true)}
            >
              <SendIcon /> Abschicken
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}

/** Angehängte Datei: Vorschaubild (bei Bildern) + Name, entfernbar */
function Attachment({ path, onRemove }: { path: string; onRemove: () => void }): React.JSX.Element {
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
      <button className="icon" title="Entfernen" onClick={onRemove}>
        <CloseIcon />
      </button>
    </div>
  )
}

export default EditorTab
