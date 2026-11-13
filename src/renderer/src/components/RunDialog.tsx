import { useCallback, useEffect, useRef, useState } from 'react'
import type { Agent, Project, RunInfo } from '../../../shared/types'
import { errorText } from '../lib/errors'
import Modal from './Modal'

interface Props {
  project: Project
  /** Agent that receives a screenshot of the preview (the project's active agent) */
  agent?: Agent
  onEditProject: () => void
  onClose: () => void
}

/** Keep at most this much output in the window */
const MAX_SHOWN = 200_000

/**
 * Run: start/stop the project's commands (dev server, tests …) and see their output.
 * The processes keep running when the window is closed; agents read it via `run_output`.
 * Plus the web preview in its own window, with a screenshot to the agent.
 */
function RunDialog({ project, agent, onEditProject, onClose }: Props): React.JSX.Element {
  const [runs, setRuns] = useState<RunInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [output, setOutput] = useState('')
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null)
  const outRef = useRef<HTMLPreElement>(null)
  const selectedRef = useRef<string | null>(null)

  const refresh = useCallback(
    () =>
      window.api.runs.list(project.id).then((list) => {
        setRuns(list)
        setSelected((s) => s ?? list[0]?.name ?? null)
      }),
    [project.id]
  )

  useEffect(() => {
    refresh()
    const offChanged = window.api.runs.onChanged((id) => id === project.id && refresh())
    const offOutput = window.api.runs.onOutput((id, name, chunk) => {
      if (id === project.id && name === selectedRef.current)
        setOutput((o) => (o + chunk).slice(-MAX_SHOWN))
    })
    return () => {
      offChanged()
      offOutput()
    }
  }, [project.id, refresh])

  // Load the output of the selected command
  useEffect(() => {
    selectedRef.current = selected
    if (!selected) return
    let cancelled = false
    window.api.runs.output(project.id, selected).then((o) => !cancelled && setOutput(o))
    return () => {
      cancelled = true
    }
  }, [project.id, selected])

  // Stay at the end
  useEffect(() => {
    const el = outRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [output])

  const guard = (p: Promise<unknown>, done?: string): void => {
    setNote(null)
    p.then(() => done && setNote({ text: done })).catch((e) =>
      setNote({ text: errorText(e), error: true })
    )
  }

  const current = runs.find((r) => r.name === selected)

  return (
    <Modal
      title={`Ausführen · ${project.name}`}
      onClose={onClose}
      width={Math.min(1100, window.innerWidth - 60)}
      footer={<button onClick={onClose}>Schließen</button>}
    >
      <div className="run-bar">
        <button
          disabled={!project.previewUrl}
          title={project.previewUrl ?? 'Keine Vorschau-Adresse eingetragen (Projekt bearbeiten)'}
          onClick={() => guard(window.api.preview.open(project.id))}
        >
          Vorschau öffnen
        </button>
        <button
          disabled={!project.previewUrl || !agent}
          title={
            agent
              ? `Bild der Vorschau als Anhang in den Prompt von ${agent.name} eintragen (noch nicht abgeschickt)`
              : 'Dafür muss ein Agent dieses Projekts ausgewählt sein'
          }
          onClick={() =>
            agent &&
            guard(
              window.api.preview.screenshot(project.id, agent.id),
              `Screenshot steht im Prompt von ${agent.name}.`
            )
          }
        >
          Screenshot an {agent?.name ?? 'Agent'}
        </button>
        <span className="muted">{project.previewUrl}</span>
        <button className="link" onClick={onEditProject}>
          Befehle und Vorschau einrichten …
        </button>
      </div>
      {note && <p className={note.error ? 'error' : 'muted'}>{note.text}</p>}

      {runs.length === 0 ? (
        <p className="muted">
          Für dieses Projekt sind noch keine Befehle eingerichtet (z. B. „dev = npm run dev“, „test
          = npm test“). Sie laufen im Agent-Ordner; Agents können ihre Ausgabe lesen.
        </p>
      ) : (
        <div className="run-main">
          <div className="run-list">
            {runs.map((r) => (
              <div
                key={r.name}
                className={`run-item ${r.name === selected ? 'selected' : ''}`}
                onClick={() => {
                  setOutput('')
                  setSelected(r.name)
                }}
                title={r.command}
              >
                <span
                  className={`dot ${r.running ? 'working' : r.exitCode ? 'needsInput' : 'idle'}`}
                />
                <span className="row-name">
                  {r.name}
                  <span className="row-sub run-state">
                    {r.running
                      ? 'läuft'
                      : r.exitCode === undefined
                        ? 'nicht gestartet'
                        : `beendet (${r.exitCode ?? '?'})`}
                  </span>
                </span>
                {r.running ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      guard(window.api.runs.stop(project.id, r.name))
                    }}
                  >
                    Stopp
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setOutput('')
                      setSelected(r.name)
                      guard(window.api.runs.start(project.id, r.name))
                    }}
                  >
                    Start
                  </button>
                )}
              </div>
            ))}
          </div>
          <pre className="run-output" ref={outRef}>
            {current && <span className="muted">{`$ ${current.command}\n`}</span>}
            {output}
          </pre>
        </div>
      )}
    </Modal>
  )
}

export default RunDialog
