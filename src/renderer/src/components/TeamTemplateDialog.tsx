import { useState } from 'react'
import type { AgentTemplate, TeamMember, TeamTemplate } from '../../../shared/types'
import { errorText } from '../lib/errors'
import DictationTextarea from './DictationTextarea'
import Modal from './Modal'

interface Props {
  /** null = neues Team */
  team: TeamTemplate | null
  /** Vordefinierte Agents zur Auswahl */
  templates: AgentTemplate[]
  onSaved: (t: TeamTemplate) => void
  onClose: () => void
}

const MAX_MEMBERS = 8

/** Team aus vordefinierten Agents zusammenstellen: Name, Mitglieder (erstes = Leitung), Richtlinien. */
function TeamTemplateDialog({ team, templates, onSaved, onClose }: Props): React.JSX.Element {
  const [name, setName] = useState(team?.name ?? '')
  // Neues Team: mit den ersten beiden vordefinierten Agents vorbelegen
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
      title={team ? `Team: ${team.name}` : 'Neues Team'}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button
            className="primary"
            onClick={save}
            disabled={saving || !name.trim() || members.length < 2}
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
            Per Sprache startbar, z. B. „Starte das Team {name.trim() || 'Feature'} für DevHub“.
          </small>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Feature, Bugfix, Review"
            autoFocus
          />
        </label>

        <div className="field">
          <span>Mitglieder</span>
          <small className="muted">
            Das erste Mitglied leitet das Team: Es bekommt die Aufgabe und verteilt sie per
            Team-Nachricht. Alle Mitglieder dürfen sich gegenseitig Nachrichten schicken.
          </small>
          <div className="member-list">
            {members.map((m, i) => (
              <div key={i} className="member-row">
                <span className="member-index muted">{i === 0 ? 'Leitung' : `${i + 1}.`}</span>
                <select
                  value={m.templateId ?? ''}
                  onChange={(e) => update(i, { templateId: e.target.value || undefined })}
                >
                  <option value="">Normaler Agent</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.model ? ` (${t.model})` : ''}
                    </option>
                  ))}
                </select>
                <button
                  className="icon"
                  title="Nach oben"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  className="icon"
                  title="Nach unten"
                  disabled={i === members.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  className="icon"
                  title="Entfernen"
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
              + Mitglied
            </button>
          </div>
          {templates.length === 0 && (
            <small className="muted">
              Tipp: Lege zuerst vordefinierte Agents (z. B. Entwickler, Reviewer) an, um ihnen
              Rollen zu geben.
            </small>
          )}
        </div>

        <div className="field">
          <span>
            Gemeinsame Richtlinien <em>(optional)</em>
          </span>
          <small className="muted">
            Gilt für alle Mitglieder zusätzlich zu ihren eigenen Richtlinien, z. B. Ablauf und
            Übergaben. Mit dem Mikrofon diktieren.
          </small>
          <DictationTextarea
            value={instructions}
            onChange={setInstructions}
            minHeight={130}
            placeholder={
              'z. B. Der Entwickler setzt um und übergibt dann an den Reviewer. Der Reviewer ' +
              'prüft und meldet Befunde zurück, bis alles passt. Erst dann wird committet.'
            }
          />
        </div>

        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  )
}

export default TeamTemplateDialog
