import { useState } from 'react'
import type {
  Agent,
  PermissionAnswer,
  PermissionInfo,
  Project,
  UserNotice
} from '../../../shared/types'
import { isTeamWorker } from '../../../shared/types'
import { timeOf } from '../lib/format'
import { CloseIcon, SendIcon } from './Icons'

/** Two agents have edited the same file */
export interface FileConflict {
  key: string
  filePath: string
  agentIds: string[]
}

interface Props {
  agents: Agent[]
  projects: Project[]
  permissions: PermissionInfo[]
  notices: UserNotice[]
  conflicts: FileConflict[]
  onSelectAgent: (id: string) => void
  onAnswer: (id: number, answer: PermissionAnswer, message?: string) => void
  /** Reply to a finished agent (text + Enter) */
  onReply: (agentId: string, text: string) => void
  onDismissNotice: (id: number) => void
  onDismissConflict: (key: string) => void
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/**
 * Inbox at the bottom of the sidebar: everything waiting for the user – permission requests
 * (with decision), waiting agents (finished ones with direct reply), notices from the agents and
 * warnings when two agents edit the same file. Empty = invisible.
 */
function InboxPanel(props: Props): React.JSX.Element | null {
  const [replies, setReplies] = useState<Record<string, string>>({})
  const [denying, setDenying] = useState<{ id: number; reason: string } | null>(null)
  const name = (id?: string): string => props.agents.find((a) => a.id === id)?.name ?? 'Agent'
  const withPermission = new Set(props.permissions.map((p) => p.agentId))
  const waiting = props.agents.filter(
    (a) => a.status === 'needsInput' && !isTeamWorker(a) && !withPermission.has(a.id)
  )
  const count =
    props.permissions.length + waiting.length + props.notices.length + props.conflicts.length
  if (count === 0) return null

  const reply = (a: Agent): void => {
    const text = replies[a.id]?.trim()
    if (!text) return
    props.onReply(a.id, text)
    setReplies((r) => ({ ...r, [a.id]: '' }))
  }

  return (
    <section className="inbox">
      <header className="inbox-header">
        Eingang <span className="count">{count}</span>
      </header>
      <div className="inbox-list">
        {props.permissions.map((p) => (
          <div key={`p${p.id}`} className="inbox-item permission">
            <div className="inbox-title" onClick={() => props.onSelectAgent(p.agentId)}>
              <strong>{name(p.agentId)}</strong> möchte <strong>{p.tool}</strong> ausführen
            </div>
            <pre className="inbox-code">{p.summary}</pre>
            {denying?.id === p.id ? (
              <div className="inbox-reply">
                <input
                  autoFocus
                  value={denying.reason}
                  placeholder="Begründung / was stattdessen (optional)"
                  onChange={(e) => setDenying({ id: p.id, reason: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      props.onAnswer(p.id, 'deny', denying.reason)
                      setDenying(null)
                    }
                    if (e.key === 'Escape') setDenying(null)
                  }}
                />
                <button
                  className="danger"
                  onClick={() => {
                    props.onAnswer(p.id, 'deny', denying.reason)
                    setDenying(null)
                  }}
                >
                  Ablehnen
                </button>
              </div>
            ) : (
              <div className="inbox-actions">
                <button className="primary" onClick={() => props.onAnswer(p.id, 'allow')}>
                  Erlauben
                </button>
                <button onClick={() => setDenying({ id: p.id, reason: '' })}>Ablehnen</button>
                {p.rule && (
                  <button
                    title={`Regel „${p.rule}“ für dieses Projekt speichern: solche Aufrufe werden künftig ohne Nachfrage erlaubt (Projekt bearbeiten → Freigabe-Regeln)`}
                    onClick={() => props.onAnswer(p.id, 'always')}
                  >
                    Immer
                  </button>
                )}
                <button
                  className="link"
                  title="Den normalen Dialog im Terminal des Agents zeigen"
                  onClick={() => props.onAnswer(p.id, 'terminal')}
                >
                  im Terminal
                </button>
              </div>
            )}
          </div>
        ))}

        {waiting.map((a) => {
          // Direct reply only when the agent is done – with an open selection/question,
          // typed text would answer that instead
          const done = (a.statusMessage ?? '').startsWith('Fertig')
          return (
            <div key={a.id} className="inbox-item">
              <div
                className="inbox-title"
                onClick={() => props.onSelectAgent(a.id)}
                title={a.lastMessage ? `${a.lastMessage}\n\nKlick: Agent zeigen` : 'Agent zeigen'}
              >
                <strong>{a.name}</strong>
                <span className="muted">
                  {' '}
                  · {props.projects.find((p) => p.id === a.projectId)?.name}
                </span>
                <div className="inbox-sub">{a.statusMessage || 'Wartet auf Eingabe'}</div>
              </div>
              {done && (
                <div className="inbox-reply">
                  <input
                    value={replies[a.id] ?? ''}
                    placeholder={`Nächste Anweisung an ${a.name}`}
                    onChange={(e) => setReplies((r) => ({ ...r, [a.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && reply(a)}
                  />
                  <button
                    className="icon"
                    title="Abschicken"
                    disabled={!replies[a.id]?.trim()}
                    onClick={() => reply(a)}
                  >
                    <SendIcon />
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {props.conflicts.map((c) => (
          <div key={c.key} className="inbox-item conflict">
            <div className="inbox-title" title={c.filePath}>
              <strong>{c.agentIds.map(name).join(' und ')}</strong> bearbeiten dieselbe Datei
              <div className="inbox-sub">{baseName(c.filePath)}</div>
            </div>
            <button
              className="icon inbox-close"
              title="Ausblenden"
              onClick={() => props.onDismissConflict(c.key)}
            >
              <CloseIcon size={10} />
            </button>
          </div>
        ))}

        {props.notices.map((n) => (
          <div key={`n${n.id}`} className="inbox-item notice">
            <div
              className="inbox-title"
              onClick={() => n.agentId && props.onSelectAgent(n.agentId)}
            >
              {n.message}
              <div className="inbox-sub muted">{timeOf(n.at)}</div>
            </div>
            <button
              className="icon inbox-close"
              title="Ausblenden"
              onClick={() => props.onDismissNotice(n.id)}
            >
              <CloseIcon size={10} />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

export default InboxPanel
