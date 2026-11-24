import { useState } from 'react'
import type { Agent, AgentTemplate, Project, Task, TaskStatus } from '../../../shared/types'
import { isTeamWorker } from '../../../shared/types'
import { dateTimeOf } from '../lib/format'
import { errorText } from '../lib/errors'
import { useT } from '../lib/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import DictationTextarea from './DictationTextarea'
import Modal from './Modal'

interface Props {
  projects: Project[]
  /** Preselected project */
  projectId: string
  agents: Agent[]
  templates: AgentTemplate[]
  tasks: Task[]
  /** Agent was started for a task → show it */
  onAgentStarted: (agent: Agent) => void
  onClose: () => void
}

/** Titles are translation keys (translated where they are rendered) */
const COLUMNS: { status: TaskStatus; title: TranslationKey }[] = [
  { status: 'open', title: 'tasks.columnOpen' },
  { status: 'running', title: 'tasks.columnRunning' },
  { status: 'done', title: 'tasks.columnDone' }
]

/**
 * Task board per project: collect tasks, start them with a new agent or put them into a
 * running agent's queue. DevHub sets a task to done as soon as the agent reports done.
 */
function TaskBoardDialog(props: Props): React.JSX.Element {
  const t = useT()
  const [projectId, setProjectId] = useState(props.projectId)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const tasks = props.tasks.filter((task) => task.projectId === projectId)
  // Only agents that can be addressed accept instructions (no team workers)
  const agents = props.agents.filter((a) => a.projectId === projectId && !isTeamWorker(a))

  const guard = (p: Promise<unknown>): void => {
    setError(null)
    p.catch((e) => setError(errorText(e)))
  }

  const add = (): void => {
    if (!draft.trim()) return
    guard(window.api.tasks.save({ projectId, text: draft }).then(() => setDraft('')))
  }

  const card = (task: Task): React.JSX.Element => {
    const queuedAt = props.agents.find((a) => a.queue?.some((q) => q.taskId === task.id))
    return (
      <div key={task.id} className="task-card">
        <div className="task-text">{task.text}</div>
        <div className="muted task-meta">
          {task.status === 'done' && task.doneAt
            ? task.agentName
              ? t('tasks.metaDoneBy', { date: dateTimeOf(task.doneAt), agent: task.agentName })
              : t('tasks.metaDone', { date: dateTimeOf(task.doneAt) })
            : queuedAt
              ? t('tasks.metaQueuedAt', { agent: queuedAt.name })
              : task.agentName
                ? task.agentName
                : t('tasks.metaCreated', { date: dateTimeOf(task.createdAt) })}
        </div>
        <div className="task-actions">
          {task.status === 'open' && !queuedAt && (
            <>
              <select
                value=""
                title={t('tasks.startWithTooltip')}
                onChange={(e) => {
                  const v = e.target.value
                  if (!v) return
                  guard(
                    window.api.tasks
                      .start(task.id, v === 'agent' ? undefined : v)
                      .then(props.onAgentStarted)
                  )
                }}
              >
                <option value="">{t('tasks.startWith')}</option>
                <option value="agent">{t('tasks.startWithNewAgent')}</option>
                {props.templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
              {agents.length > 0 && (
                <select
                  value=""
                  title={t('tasks.assignTooltip')}
                  onChange={(e) =>
                    e.target.value && guard(window.api.tasks.assign(task.id, e.target.value))
                  }
                >
                  <option value="">{t('tasks.assignTo')}</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          {task.status !== 'done' && (
            <button
              className="link"
              onClick={() => guard(window.api.tasks.setStatus(task.id, 'done'))}
            >
              {t('tasks.markDone')}
            </button>
          )}
          {task.status !== 'open' && (
            <button
              className="link"
              onClick={() => guard(window.api.tasks.setStatus(task.id, 'open'))}
            >
              {t('tasks.reopen')}
            </button>
          )}
          <button
            className="link danger"
            onClick={() => {
              if (confirm(t('tasks.confirmDelete'))) guard(window.api.tasks.remove(task.id))
            }}
          >
            {t('tasks.delete')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <Modal
      title={t('tasks.title')}
      onClose={props.onClose}
      width={Math.min(1100, window.innerWidth - 60)}
      footer={<button onClick={props.onClose}>{t('common.close')}</button>}
    >
      <div className="form">
        <label>
          <span>{t('common.project')}</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {props.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('tasks.newTaskLabel')}</span>
          <DictationTextarea
            value={draft}
            onChange={setDraft}
            minHeight={70}
            placeholder={t('tasks.newTaskPlaceholder')}
          />
        </label>
        <div>
          <button className="primary" disabled={!draft.trim()} onClick={add}>
            {t('tasks.create')}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="task-board">
        {COLUMNS.map((col) => {
          const list = tasks
            .filter((task) => task.status === col.status)
            .sort((a, b) => (b.doneAt ?? b.createdAt) - (a.doneAt ?? a.createdAt))
          return (
            <div key={col.status} className="task-column">
              <h3>
                {t(col.title)} <span className="count">{list.length}</span>
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
