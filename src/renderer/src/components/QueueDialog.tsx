import { useState } from 'react'
import type { Agent, PromptTemplate } from '../../../shared/types'
import { fillPlaceholders, placeholdersOf } from '../lib/format'
import { errorText } from '../lib/errors'
import { useT } from '../lib/i18n'
import DictationTextarea from './DictationTextarea'
import Modal from './Modal'

interface Props {
  agent: Agent
  prompts: PromptTemplate[]
  /** Prefill this prompt from the library */
  promptId?: string
  onClose: () => void
}

/**
 * Instruction for an agent: freely written/dictated or from the prompt library (placeholders
 * `{{name}}` are asked for). The instruction goes into the queue – it is sent immediately if
 * the agent is free, otherwise as soon as it reports done. Also shows the queued instructions.
 */
function QueueDialog({ agent, prompts, promptId, onClose }: Props): React.JSX.Element {
  const t = useT()
  const initial = prompts.find((p) => p.id === promptId)
  const [chosen, setChosen] = useState(initial?.id ?? '')
  const [text, setText] = useState(initial?.text ?? '')
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const names = placeholdersOf(text)
  const queue = agent.queue ?? []
  const busy = agent.status === 'working' || agent.status === 'starting'

  const send = async (): Promise<void> => {
    try {
      await window.api.agents.enqueue(agent.id, fillPlaceholders(text, values))
      onClose()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <Modal
      title={t('queue.title', { name: agent.name })}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="primary"
            disabled={!text.trim() || names.some((n) => !values[n]?.trim())}
            onClick={send}
          >
            {busy || queue.length ? t('queue.enqueue') : t('common.send')}
          </button>
        </>
      }
    >
      <div className="form">
        {prompts.length > 0 && (
          <label>
            <span>{t('queue.fromLibrary')}</span>
            <select
              value={chosen}
              onChange={(e) => {
                setChosen(e.target.value)
                const p = prompts.find((x) => x.id === e.target.value)
                if (p) setText(p.text)
                setValues({})
              }}
            >
              <option value="">{t('queue.freeText')}</option>
              {prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>{t('queue.instructionLabel')}</span>
          <DictationTextarea
            value={text}
            onChange={setText}
            minHeight={120}
            placeholder={t('queue.instructionPlaceholder')}
          />
        </label>
        {names.map((n) => (
          <label key={n}>
            <span>{n}</span>
            <input
              value={values[n] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [n]: e.target.value }))}
            />
          </label>
        ))}
        <small className="muted">
          {busy ? t('queue.hintBusy', { name: agent.name }) : t('queue.hintFree')}
        </small>
        {error && <p className="error">{error}</p>}
      </div>

      {queue.length > 0 && (
        <section className="settings-section">
          <h3>{t('queue.queuedHeading')}</h3>
          <div className="template-list">
            {queue.map((q, i) => (
              <div key={q.id} className="template-item">
                <span className="template-info" title={q.text}>
                  {i + 1}. {q.text}
                </span>
                <button
                  className="link danger"
                  onClick={() =>
                    window.api.agents.dequeue(agent.id, q.id).catch((e) => setError(errorText(e)))
                  }
                >
                  {t('queue.remove')}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </Modal>
  )
}

export default QueueDialog
