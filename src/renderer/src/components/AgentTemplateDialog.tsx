import { useState } from 'react'
import type { AgentTemplate } from '../../../shared/types'
import { isValidModelName } from '../../../shared/agentArgs'
import { errorText } from '../lib/errors'
import { useT } from '../lib/i18n'
import DictationTextarea from './DictationTextarea'
import Modal from './Modal'

interface Props {
  /** null = new template */
  template: AgentTemplate | null
  onSaved: (t: AgentTemplate) => void
  onClose: () => void
}

/** Suggestions for the model field (Claude Code aliases); free input is still possible. */
const MODEL_SUGGESTIONS = ['fable', 'opus', 'sonnet', 'haiku']

/** Create/edit a predefined agent: name, model, role/guidelines (dictation supported). */
function AgentTemplateDialog({ template, onSaved, onClose }: Props): React.JSX.Element {
  const t = useT()
  const [name, setName] = useState(template?.name ?? '')
  const [model, setModel] = useState(template?.model ?? '')
  const [instructions, setInstructions] = useState(template?.instructions ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const modelError =
    model.trim() && !isValidModelName(model.trim()) ? t('templates.invalidModelName') : null

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
      title={
        template
          ? t('templates.agentTitleEdit', { name: template.name })
          : t('templates.agentTitleNew')
      }
      onClose={onClose}
      width={640}
      footer={
        <>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="primary"
            onClick={save}
            disabled={saving || !name.trim() || !!modelError}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="form">
        <label>
          <span>{t('common.name')}</span>
          <small className="muted">
            {t('templates.agentNameHelp', {
              name: name.trim() || t('common.name'),
              example: name.trim() || t('templates.agentNameExample')
            })}
          </small>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('templates.agentNamePlaceholder')}
            autoFocus
          />
        </label>

        <label>
          <span>
            {t('common.model')} <em>({t('common.optional')})</em>
          </span>
          <small className="muted">{t('templates.modelHelp')}</small>
          <input
            className="mono"
            list="template-models"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t('templates.modelPlaceholder')}
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
            {t('templates.roleLabel')} <em>({t('common.optional')})</em>
          </span>
          <small className="muted">{t('templates.roleHelp')}</small>
          <DictationTextarea
            value={instructions}
            onChange={setInstructions}
            placeholder={t('templates.rolePlaceholder')}
          />
        </label>

        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  )
}

export default AgentTemplateDialog
