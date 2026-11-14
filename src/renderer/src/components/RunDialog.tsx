import { useCallback, useEffect, useRef, useState } from 'react'
import type { Agent, Project, RunInfo } from '../../../shared/types'
import { errorText } from '../lib/errors'
import { useT } from '../lib/i18n'
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
  const t = useT()
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
      title={t('run.title', { project: project.name })}
      onClose={onClose}
      width={Math.min(1100, window.innerWidth - 60)}
      footer={<button onClick={onClose}>{t('common.close')}</button>}
    >
      <div className="run-bar">
        <button
          disabled={!project.previewUrl}
          title={project.previewUrl ?? t('run.noPreviewUrl')}
          onClick={() => guard(window.api.preview.open(project.id))}
        >
          {t('run.openPreview')}
        </button>
        <button
          disabled={!project.previewUrl || !agent}
          title={
            agent
              ? t('run.screenshotTooltip', { name: agent.name })
              : t('run.screenshotNoAgentTooltip')
          }
          onClick={() =>
            agent &&
            guard(
              window.api.preview.screenshot(project.id, agent.id),
              t('run.screenshotDone', { name: agent.name })
            )
          }
        >
          {t('run.screenshotTo', { name: agent?.name ?? t('common.agent') })}
        </button>
        <span className="muted">{project.previewUrl}</span>
        <button className="link" onClick={onEditProject}>
          {t('run.setup')}
        </button>
      </div>
      {note && <p className={note.error ? 'error' : 'muted'}>{note.text}</p>}

      {runs.length === 0 ? (
        <p className="muted">{t('run.empty')}</p>
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
                      ? t('run.stateRunning')
                      : r.exitCode === undefined
                        ? t('run.stateNotStarted')
                        : t('run.stateExited', { code: r.exitCode ?? '?' })}
                  </span>
                </span>
                {r.running ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      guard(window.api.runs.stop(project.id, r.name))
                    }}
                  >
                    {t('run.stop')}
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
                    {t('run.start')}
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
