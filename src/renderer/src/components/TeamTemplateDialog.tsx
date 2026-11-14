import { useState } from 'react'
import type { AgentTemplate, TeamMember, TeamTemplate } from '../../../shared/types'
import { errorText } from '../lib/errors'
import { useT } from '../lib/i18n'
import DictationTextarea from './DictationTextarea'
import Modal from './Modal'

interface Props {
  /** null = new team */
  team: TeamTemplate | null
  /** Predefined agents to choose from */
  templates: AgentTemplate[]
  onSaved: (t: TeamTemplate) => void
  onClose: () => void
}

const MAX_MEMBERS = 8

/** Assemble a team from predefined agents: name, members (+ automatic orchestrator), guidelines. */
function TeamTemplateDialog({ team, templates, onSaved, onClose }: Props): React.JSX.Element {
  const t = useT()
  const [name, setName] = useState(team?.name ?? '')
  // New team: prefill with the first two predefined agents
  const [members, setMembers] = useState<TeamMember[]>(
    team?.members ?? [{ templateId: templates[0]?.id }, { templateId: templates[1]?.id }]
  )
  const [instructions, setInstructions] = useState(team?.instructions ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const update = (i: number, m: TeamMember): void =>
    setMembers((list) => list.map((x, j) => (j === i ? m : x)))
  const move = (i: number, dir: -1 | 1): void =>
    setMembers((list) => {
      const next = [...list]
      ;[next[i], next[i + dir]] = [next[i + dir], next[i]]
      return next
    })

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      onSaved(
        await window.api.teamTemplates.save({
          id: team?.id,
          name,
          members,
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
      title={team ? t('templates.teamTitleEdit', { name: team.name }) : t('templates.teamTitleNew')}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="primary"
            onClick={save}
            disabled={saving || !name.trim() || members.length < 2}
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
            {t('templates.teamNameHelp', {
              name: name.trim() || t('templates.teamNameExample')
            })}
          </small>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('templates.teamNamePlaceholder')}
            autoFocus
          />
        </label>

        <div className="field">
          <span>{t('templates.membersLabel')}</span>
          <small className="muted">{t('templates.membersHelp')}</small>
          <div className="member-list">
            {members.map((m, i) => (
              <div key={i} className="member-row">
                <span className="member-index muted">{`${i + 1}.`}</span>
                <select
                  value={m.templateId ?? ''}
                  onChange={(e) => update(i, { templateId: e.target.value || undefined })}
                >
                  <option value="">{t('templates.normalAgent')}</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                      {tpl.model ? ` (${tpl.model})` : ''}
                    </option>
                  ))}
                </select>
                <button
                  className="icon"
                  title={t('common.moveUp')}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  className="icon"
                  title={t('common.moveDown')}
                  disabled={i === members.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  className="icon"
                  title={t('common.remove')}
                  disabled={members.length <= 2}
                  onClick={() => setMembers((list) => list.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div>
            <button
              disabled={members.length >= MAX_MEMBERS}
              onClick={() => setMembers((list) => [...list, { templateId: templates[0]?.id }])}
            >
              {t('templates.addMember')}
            </button>
          </div>
          {templates.length === 0 && (
            <small className="muted">{t('templates.noTemplatesTip')}</small>
          )}
        </div>

        <div className="field">
          <span>
            {t('templates.sharedGuidelinesLabel')} <em>({t('common.optional')})</em>
          </span>
          <small className="muted">{t('templates.sharedGuidelinesHelp')}</small>
          <DictationTextarea
            value={instructions}
            onChange={setInstructions}
            minHeight={130}
            placeholder={t('templates.sharedGuidelinesPlaceholder')}
          />
        </div>

        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  )
}

export default TeamTemplateDialog
