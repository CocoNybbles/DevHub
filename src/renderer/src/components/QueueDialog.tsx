import { useState } from 'react'
import type { Agent, PromptTemplate } from '../../../shared/types'
import { fillPlaceholders, placeholdersOf } from '../lib/format'
import { errorText } from '../lib/errors'
import DictationTextarea from './DictationTextarea'
import Modal from './Modal'

interface Props {
  agent: Agent
  prompts: PromptTemplate[]
  /** Diesen Prompt aus der Bibliothek vorbelegen */
  promptId?: string
  onClose: () => void
}

/**
 * Auftrag für einen Agent: frei geschrieben/diktiert oder aus der Prompt-Bibliothek (Platzhalter
 * `{{name}}` werden abgefragt). Der Auftrag kommt in die Warteschlange – er geht sofort raus, wenn
 * der Agent frei ist, sonst sobald er fertig meldet. Zeigt auch die wartenden Aufträge.
 */
function QueueDialog({ agent, prompts, promptId, onClose }: Props): React.JSX.Element {
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
      title={`Auftrag für ${agent.name}`}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button
            className="primary"
            disabled={!text.trim() || names.some((n) => !values[n]?.trim())}
            onClick={send}
          >
            {busy || queue.length ? 'In die Warteschlange' : 'Abschicken'}
          </button>
        </>
      }
    >
      <div className="form">
        {prompts.length > 0 && (
          <label>
            <span>Aus der Prompt-Bibliothek</span>
            <select
              value={chosen}
              onChange={(e) => {
                setChosen(e.target.value)
                const p = prompts.find((x) => x.id === e.target.value)
                if (p) setText(p.text)
                setValues({})
              }}
            >
              <option value="">– frei schreiben –</option>
              {prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>Anweisung</span>
          <DictationTextarea
            value={text}
            onChange={setText}
            minHeight={120}
            placeholder="Was soll der Agent als Nächstes tun?"
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
          {busy
            ? `${agent.name} arbeitet gerade – der Auftrag wird abgeschickt, sobald er fertig meldet.`
            : 'Der Auftrag geht sofort an den Agent, wenn nichts davor wartet.'}
        </small>
        {error && <p className="error">{error}</p>}
      </div>

      {queue.length > 0 && (
        <section className="settings-section">
          <h3>Wartet bereits</h3>
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
                  entfernen
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
