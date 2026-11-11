import { useState } from 'react'
import type { AgentTemplate } from '../../../shared/types'
import { isValidModelName } from '../../../shared/agentArgs'
import { errorText } from '../lib/errors'
import DictationTextarea from './DictationTextarea'
import Modal from './Modal'

interface Props {
  /** null = neue Vorlage */
  template: AgentTemplate | null
  onSaved: (t: AgentTemplate) => void
  onClose: () => void
}

/** Vorschläge für das Modellfeld (Aliase von Claude Code); freie Eingabe bleibt möglich. */
const MODEL_SUGGESTIONS = ['fable', 'opus', 'sonnet', 'haiku']

/** Vordefinierten Agent anlegen/bearbeiten: Name, Modell, Rolle/Richtlinien (auch per Diktat). */
function AgentTemplateDialog({ template, onSaved, onClose }: Props): React.JSX.Element {
  const [name, setName] = useState(template?.name ?? '')
  const [model, setModel] = useState(template?.model ?? '')
  const [instructions, setInstructions] = useState(template?.instructions ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const modelError =
    model.trim() && !isValidModelName(model.trim()) ? 'Ungültiger Modellname' : null

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      onSaved(
        await window.api.templates.save({
          id: template?.id,
          name,
          model: model.trim() || undefined,
          instructions: instructions.trim() || undefined
        })
      )
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={template ? `Vordefinierter Agent: ${template.name}` : 'Neuer vordefinierter Agent'}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button
            className="primary"
            onClick={save}
            disabled={saving || !name.trim() || !!modelError}
          >
            Speichern
          </button>
        </>
      }
    >
      <div className="form">
        <label>
          <span>Name</span>
          <small className="muted">
            So heißt der Agent beim Start (weitere: „{name.trim() || 'Name'} 2“ …) und so sprichst
            du ihn per Sprache an, z. B. „Starte einen {name.trim() || 'Entwickler'} für DevHub“.
          </small>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Entwickler, Reviewer, Tester"
            autoFocus
          />
        </label>

        <label>
          <span>
            Modell <em>(optional)</em>
          </span>
          <small className="muted">
            Leer = wie in den Start-Flags. Nennst du beim Sprachbefehl ein Modell, hat das Vorrang.
          </small>
          <input
            className="mono"
            list="template-models"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="z. B. opus, sonnet oder claude-opus-5-5"
            spellCheck={false}
          />
          <datalist id="template-models">
            {MODEL_SUGGESTIONS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {modelError && <small className="error">{modelError}</small>}
        </label>

        <label>
          <span>
            Rolle und Richtlinien <em>(optional)</em>
          </span>
          <small className="muted">
            Wird dem Agent bei jedem Start als Anweisung mitgegeben, z. B. wie er arbeiten, testen
            und committen soll. Mit dem Mikrofon diktieren.
          </small>
          <DictationTextarea
            value={instructions}
            onChange={setInstructions}
            placeholder={
              'z. B. Du bist ein erfahrener Entwickler. Schreibe zu jeder Änderung Tests, ' +
              'halte dich an die Konventionen in CLAUDE.md und erkläre kurz, was du geändert hast.'
            }
          />
        </label>

        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  )
}

export default AgentTemplateDialog
