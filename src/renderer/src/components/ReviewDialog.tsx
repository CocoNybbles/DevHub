import { useCallback, useEffect, useRef, useState } from 'react'
import type { Agent, GitFileChange, Project, ReviewInfo, ReviewTarget } from '../../../shared/types'
import { languageForPath, monaco } from '../lib/monaco'
import { errorText } from '../lib/errors'
import Modal from './Modal'

interface Props {
  project: Project
  agents: Agent[]
  /** Arbeitsverzeichnis dieses Agents vorwählen */
  agentId?: string
  /** Diese Datei vorwählen (absoluter Pfad, z. B. aus `show_diff`) */
  filePath?: string
  onClose: () => void
}

interface Comment {
  path: string
  lines: string
  text: string
}

const KIND_LABEL: Record<GitFileChange['kind'], string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  untracked: 'N'
}
const KIND_TITLE: Record<GitFileChange['kind'], string> = {
  modified: 'geändert',
  added: 'hinzugefügt',
  deleted: 'gelöscht',
  untracked: 'neu (noch nicht in Git)'
}

/**
 * Änderungen eines Arbeitsverzeichnisses (Hauptordner oder Worktree eines Agents) prüfen:
 * Dateiliste, Vergleich nebeneinander (rechte Seite bearbeitbar, Pfeile am Rand nehmen einzelne
 * Änderungen zurück), verwerfen, committen, Worktree zusammenführen, Kommentare an den Agent.
 */
function ReviewDialog({ project, agents, agentId, filePath, onClose }: Props): React.JSX.Element {
  const [info, setInfo] = useState<ReviewInfo | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [changes, setChanges] = useState<GitFileChange[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [binary, setBinary] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState('')
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentText, setCommentText] = useState('')

  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  /** Datei, die beim nächsten Laden der Liste gewählt werden soll (aus `show_diff`) */
  const wantedFile = useRef(filePath)

  const target: ReviewTarget | undefined = info?.targets.find((t) => t.id === targetId)
  const targetAgent = agents.find((a) => a.id === target?.agentId)
  const fail = (e: unknown): void => setNote({ text: errorText(e), error: true })

  const loadChanges = useCallback(
    async (id: string, keep?: string | null) => {
      const list = await window.api.git.changes(project.id, id)
      setChanges(list)
      const wanted = wantedFile.current?.replace(/\\/g, '/').toLowerCase()
      wantedFile.current = undefined
      const preferred =
        (wanted && list.find((c) => wanted.endsWith('/' + c.path.toLowerCase()))?.path) ||
        (keep && list.some((c) => c.path === keep) ? keep : null)
      setSelected(preferred ?? list[0]?.path ?? null)
    },
    [project.id]
  )

  const loadTargets = useCallback(
    async (preferAgent?: string) => {
      const next = await window.api.git.targets(project.id)
      setInfo(next)
      return (
        next.targets.find((t) => preferAgent && t.agentId === preferAgent) ??
        next.targets[0] ??
        null
      )
    },
    [project.id]
  )

  // Erstes Laden: Ziel des Agents (sonst Hauptordner) und dessen Änderungen
  useEffect(() => {
    let cancelled = false
    window.api.git
      .targets(project.id)
      .then(async (next) => {
        if (cancelled) return
        setInfo(next)
        const first = next.targets.find((t) => agentId && t.agentId === agentId) ?? next.targets[0]
        if (!first) return
        setTargetId(first.id)
        await loadChanges(first.id)
      })
      .catch((e) => !cancelled && setNote({ text: errorText(e), error: true }))
    return () => {
      cancelled = true
    }
  }, [project.id, agentId, loadChanges])

  // Vergleichs-Editor einmal anlegen
  useEffect(() => {
    if (!hostRef.current) return
    const editor = monaco.editor.createDiffEditor(hostRef.current, {
      theme: 'vs-dark',
      automaticLayout: true,
      readOnly: false,
      originalEditable: false,
      renderSideBySide: true,
      renderMarginRevertIcon: true,
      fontFamily: "'Cascadia Mono', Consolas, monospace",
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false
    })
    editorRef.current = editor
    return () => {
      const model = editor.getModel()
      editor.dispose()
      model?.original.dispose()
      model?.modified.dispose()
      editorRef.current = null
    }
  }, [])

  // Gewählte Datei laden
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !targetId) return
    let cancelled = false
    let listener: monaco.IDisposable | undefined
    const setModels = (original: string, modified: string, path: string): void => {
      const old = editor.getModel()
      const language = languageForPath(path)
      const modifiedModel = monaco.editor.createModel(modified, language)
      editor.setModel({
        original: monaco.editor.createModel(original, language),
        modified: modifiedModel
      })
      old?.original.dispose()
      old?.modified.dispose()
      listener = modifiedModel.onDidChangeContent(() => setDirty(true))
    }
    if (!selected) {
      setModels('', '', '')
      return
    }
    window.api.git
      .diff(project.id, targetId, selected)
      .then((d) => {
        if (cancelled) return
        setBinary(!!d.binary)
        setDirty(false)
        setModels(d.original, d.modified, selected)
      })
      .catch((e) => !cancelled && setNote({ text: errorText(e), error: true }))
    return () => {
      cancelled = true
      listener?.dispose()
    }
  }, [project.id, targetId, selected])

  /** Führt eine Aktion aus, zeigt ihr Ergebnis und lädt die Liste neu */
  const run = async (
    action: () => Promise<string | void>,
    reloadTargets = false
  ): Promise<void> => {
    if (!targetId) return
    setBusy(true)
    setNote(null)
    try {
      const result = await action()
      if (result) setNote({ text: result })
      if (reloadTargets) {
        const first = await loadTargets()
        const still = (await window.api.git.targets(project.id)).targets.some(
          (t) => t.id === targetId
        )
        const next = still ? targetId : (first?.id ?? null)
        setTargetId(next)
        if (next) await loadChanges(next, selected)
        else setChanges([])
      } else await loadChanges(targetId, selected)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const switchTarget = (id: string): void => {
    if (dirty && !confirm('Ungespeicherte Änderungen an der Datei verwerfen?')) return
    setTargetId(id)
    setSelected(null)
    setComments([])
    loadChanges(id).catch(fail)
  }

  const selectFile = (path: string): void => {
    if (path === selected) return
    if (dirty && !confirm('Ungespeicherte Änderungen an der Datei verwerfen?')) return
    setSelected(path)
  }

  const save = (): Promise<void> =>
    run(async () => {
      const content = editorRef.current?.getModel()?.modified.getValue()
      if (selected && content !== undefined)
        await window.api.git.saveFile(project.id, targetId!, selected, content)
      setDirty(false)
    })

  const addComment = (): void => {
    const text = commentText.trim()
    if (!text || !selected) return
    const sel = editorRef.current?.getModifiedEditor().getSelection()
    const lines = sel
      ? sel.startLineNumber === sel.endLineNumber
        ? `${sel.startLineNumber}`
        : `${sel.startLineNumber}-${sel.endLineNumber}`
      : ''
    setComments((c) => [...c, { path: selected, lines, text }])
    setCommentText('')
  }

  const sendComments = async (): Promise<void> => {
    if (!targetAgent || !comments.length) return
    const text =
      'Review-Kommentare zu deinen Änderungen – bitte umsetzen: ' +
      comments
        .map((c, i) => `(${i + 1}) ${c.path}${c.lines ? `:${c.lines}` : ''} – ${c.text}`)
        .join(' ')
    try {
      await window.api.agents.enqueue(targetAgent.id, text)
      setComments([])
      setNote({ text: `Kommentare an ${targetAgent.name} geschickt.` })
    } catch (e) {
      fail(e)
    }
  }

  const change = changes.find((c) => c.path === selected)
  const width = Math.min(1400, window.innerWidth - 60)

  return (
    <Modal
      title={`Änderungen prüfen · ${project.name}`}
      onClose={onClose}
      width={width}
      footer={<button onClick={onClose}>Schließen</button>}
    >
      {info && !info.isRepo ? (
        <p className="muted">
          {info.error ??
            'Der Agent-Ordner dieses Projekts liegt in keinem Git-Repository – ohne Git gibt es keinen Vergleich.'}
        </p>
      ) : (
        <div className="review">
          <div className="review-bar">
            <select
              value={targetId ?? ''}
              onChange={(e) => switchTarget(e.target.value)}
              title="Arbeitsverzeichnis: Hauptordner oder Worktree eines Agents"
            >
              {info?.targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <button disabled={busy || !targetId} onClick={() => run(async () => {})}>
              Aktualisieren
            </button>
            <span className="muted review-hint">
              {target?.isWorktree
                ? `Vergleich mit der Abzweigung von „${target.base}“ (inkl. Commits des Agents)`
                : 'Vergleich mit dem letzten Commit'}
            </span>
            {target?.isWorktree && (
              <>
                <button
                  disabled={busy}
                  title="Branch des Worktrees in den Branch zusammenführen, der im Hauptordner ausgecheckt ist"
                  onClick={() => run(() => window.api.git.merge(project.id, targetId!))}
                >
                  Zusammenführen
                </button>
                <button
                  className="danger"
                  disabled={busy || !!target.agentId}
                  title={
                    target.agentId
                      ? 'Solange der Agent läuft, bleibt sein Worktree bestehen'
                      : 'Worktree und Branch löschen'
                  }
                  onClick={() => {
                    if (
                      !confirm(
                        `Worktree „${target.label}“ samt Branch löschen?\nNicht zusammengeführte Änderungen gehen verloren.`
                      )
                    )
                      return
                    run(() => window.api.git.removeWorktree(project.id, targetId!, true), true)
                  }}
                >
                  Worktree löschen
                </button>
              </>
            )}
          </div>

          <div className="review-main">
            <div className="review-files">
              {changes.length === 0 && <div className="muted review-empty">Keine Änderungen.</div>}
              {changes.map((c) => (
                <div
                  key={c.path}
                  className={`review-file ${c.path === selected ? 'selected' : ''}`}
                  title={`${c.path}\n${KIND_TITLE[c.kind]}`}
                  onClick={() => selectFile(c.path)}
                >
                  <span className={`review-kind ${c.kind}`}>{KIND_LABEL[c.kind]}</span>
                  <span className="review-name">{c.path.split('/').pop()}</span>
                  <span className="muted review-dir">
                    {c.path.includes('/') ? c.path.slice(0, c.path.lastIndexOf('/')) : ''}
                  </span>
                </div>
              ))}
            </div>

            <div className="review-diff">
              <div className="review-diff-head">
                <span className="code-file" title={selected ?? ''}>
                  {selected ?? '–'}
                  {dirty && ' •'}
                </span>
                <button
                  disabled={busy || !dirty}
                  onClick={save}
                  title="Rechte Seite in die Datei schreiben"
                >
                  Speichern
                </button>
                <button
                  className="danger"
                  disabled={busy || !selected}
                  title={
                    change?.kind === 'untracked' || change?.kind === 'added'
                      ? 'Neue Datei löschen'
                      : 'Datei auf den Vergleichsstand zurücksetzen'
                  }
                  onClick={() => {
                    if (!selected || !confirm(`Alle Änderungen an „${selected}“ verwerfen?`)) return
                    run(() => window.api.git.discard(project.id, targetId!, selected))
                  }}
                >
                  Verwerfen
                </button>
              </div>
              {binary && (
                <div className="muted review-empty">Binärdatei oder zu groß – kein Vergleich.</div>
              )}
              <div
                className="review-editor"
                ref={hostRef}
                style={binary ? { display: 'none' } : {}}
              />
              <div className="review-comment">
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addComment()}
                  placeholder={
                    targetAgent
                      ? 'Kommentar zur markierten Stelle (rechts Zeilen markieren, Enter merkt ihn vor)'
                      : 'Kommentare gehen an den Agent dieses Verzeichnisses – hier läuft keiner'
                  }
                  disabled={!targetAgent || !selected}
                />
                <button
                  disabled={!commentText.trim() || !selected || !targetAgent}
                  onClick={addComment}
                >
                  Vormerken
                </button>
              </div>
            </div>
          </div>

          {comments.length > 0 && (
            <div className="review-comments">
              {comments.map((c, i) => (
                <div key={i} className="review-comment-item">
                  <span className="muted">
                    {c.path}
                    {c.lines && `:${c.lines}`}
                  </span>{' '}
                  {c.text}
                  <button
                    className="link"
                    onClick={() => setComments((list) => list.filter((_, j) => j !== i))}
                  >
                    entfernen
                  </button>
                </div>
              ))}
              <button className="primary" onClick={sendComments}>
                {comments.length} Kommentar(e) an {targetAgent?.name} schicken
              </button>
            </div>
          )}

          <div className="review-commit">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Commit-Nachricht"
              spellCheck={false}
            />
            <button
              disabled={busy || !message.trim() || !selected}
              title="Nur die gewählte Datei committen"
              onClick={() =>
                run(async () => {
                  const out = await window.api.git.commit(project.id, targetId!, message, [
                    selected!
                  ])
                  setMessage('')
                  return out
                })
              }
            >
              Datei committen
            </button>
            <button
              className="primary"
              disabled={busy || !message.trim() || changes.length === 0}
              onClick={() =>
                run(async () => {
                  const out = await window.api.git.commit(project.id, targetId!, message)
                  setMessage('')
                  return out
                })
              }
            >
              Alles committen
            </button>
          </div>
          {note && (
            <pre className={`review-note ${note.error ? 'error' : 'muted'}`}>{note.text}</pre>
          )}
        </div>
      )}
    </Modal>
  )
}

export default ReviewDialog
