import { useState } from 'react'
import type { Agent, AgentTemplate, Project, Task, TaskStatus } from '../../../shared/types'
import { isTeamWorker } from '../../../shared/types'
import { dateTimeOf } from '../lib/format'
import { errorText } from '../lib/errors'
import DictationTextarea from './DictationTextarea'
import Modal from './Modal'

interface Props {
  projects: Project[]
  /** Vorgewähltes Projekt */
  projectId: string
  agents: Agent[]
  templates: AgentTemplate[]
  tasks: Task[]
  /** Agent wurde für eine Aufgabe gestartet → anzeigen */
  onAgentStarted: (agent: Agent) => void
  onClose: () => void
}

const COLUMNS: { status: TaskStatus; title: string }[] = [
  { status: 'open', title: 'Offen' },
  { status: 'running', title: 'In Arbeit' },
  { status: 'done', title: 'Erledigt' }
]

/**
 * Aufgaben-Board je Projekt: Aufgaben sammeln, mit einem neuen Agent starten oder einem
 * laufenden in die Warteschlange legen. „Erledigt“ setzt DevHub, sobald der Agent fertig meldet.
 */
function TaskBoardDialog(props: Props): React.JSX.Element {
  const [projectId, setProjectId] = useState(props.projectId)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const tasks = props.tasks.filter((t) => t.projectId === projectId)
  // Aufträge nimmt nur an, wer ansprechbar ist (keine Team-Worker)
  const agents = props.agents.filter((a) => a.projectId === projectId && !isTeamWorker(a))

  const guard = (p: Promise<unknown>): void => {
    setError(null)
    p.catch((e) => setError(errorText(e)))
  }

  const add = (): void => {
    if (!draft.trim()) return
    guard(window.api.tasks.save({ projectId, text: draft }).then(() => setDraft('')))
  }

  const card = (t: Task): React.JSX.Element => {
    const queuedAt = props.agents.find((a) => a.queue?.some((q) => q.taskId === t.id))
    return (
      <div key={t.id} className="task-card">
        <div className="task-text">{t.text}</div>
        <div className="muted task-meta">
          {t.status === 'done' && t.doneAt
            ? `erledigt ${dateTimeOf(t.doneAt)}${t.agentName ? ` · ${t.agentName}` : ''}`
            : queuedAt
              ? `wartet bei ${queuedAt.name}`
              : t.agentName
                ? t.agentName
                : `angelegt ${dateTimeOf(t.createdAt)}`}
        </div>
        <div className="task-actions">
          {t.status === 'open' && !queuedAt && (
            <>
              <select
                value=""
                title="Neuen Agent mit dieser Aufgabe starten"
                onChange={(e) => {
                  const v = e.target.value
                  if (!v) return
                  guard(
                    window.api.tasks
                      .start(t.id, v === 'agent' ? undefined : v)
                      .then(props.onAgentStarted)
                  )
                }}
              >
                <option value="">Starten mit …</option>
                <option value="agent">neuem Agent</option>
                {props.templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
              {agents.length > 0 && (
                <select
                  value=""
                  title="Einem laufenden Agent geben – er bearbeitet sie, sobald er fertig ist"
                  onChange={(e) =>
                    e.target.value && guard(window.api.tasks.assign(t.id, e.target.value))
                  }
                >
                  <option value="">An Agent …</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          {t.status !== 'done' && (
            <button
              className="link"
              onClick={() => guard(window.api.tasks.setStatus(t.id, 'done'))}
            >
              erledigt
            </button>
          )}
          {t.status !== 'open' && (
            <button
              className="link"
              onClick={() => guard(window.api.tasks.setStatus(t.id, 'open'))}
            >
              wieder öffnen
            </button>
          )}
          <button
            className="link danger"
            onClick={() => {
              if (confirm('Aufgabe löschen?')) guard(window.api.tasks.remove(t.id))
            }}
          >
            löschen
          </button>
        </div>
      </div>
    )
  }

  return (
    <Modal
      title="Aufgaben"
      onClose={props.onClose}
      width={Math.min(1100, window.innerWidth - 60)}
      footer={<button onClick={props.onClose}>Schließen</button>}
    >
      <div className="form">
        <label>
          <span>Projekt</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {props.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Neue Aufgabe</span>
          <DictationTextarea
            value={draft}
            onChange={setDraft}
            minHeight={70}
            placeholder="Was soll ein Agent tun? So ausführlich, dass er ohne Rückfrage loslegen kann."
          />
        </label>
        <div>
          <button className="primary" disabled={!draft.trim()} onClick={add}>
            Aufgabe anlegen
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="task-board">
        {COLUMNS.map((col) => {
          const list = tasks
            .filter((t) => t.status === col.status)
            .sort((a, b) => (b.doneAt ?? b.createdAt) - (a.doneAt ?? a.createdAt))
          return (
            <div key={col.status} className="task-column">
              <h3>
                {col.title} <span className="count">{list.length}</span>
              </h3>
              {list.map(card)}
              {list.length === 0 && <div className="muted small">–</div>}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

export default TaskBoardDialog
