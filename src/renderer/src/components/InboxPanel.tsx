import { useState } from 'react'
import type {
  Agent,
  PermissionAnswer,
  PermissionInfo,
  Project,
  UserNotice
} from '../../../shared/types'
import { isTeamWorker } from '../../../shared/types'
import { getLocale } from '../../../shared/i18n'
import { timeOf } from '../lib/format'
import { useT } from '../lib/i18n'
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

/** Renders a translated sentence with the values of its `{placeholders}` in bold */
function withBold(text: string, values: Record<string, string>): React.ReactNode[] {
  return text
    .split(/(\{\w+\})/)
    .filter(Boolean)
    .map((part, i) => {
      const key = /^\{(\w+)\}$/.exec(part)?.[1]
      return key && Object.hasOwn(values, key) ? <strong key={i}>{values[key]}</strong> : part
    })
}

/** "A and B" / "A, B and C" in the current language */
const listOf = (names: string[]): string =>
  new Intl.ListFormat(getLocale(), { type: 'conjunction' }).format(names)

/**
 * Inbox at the bottom of the sidebar: everything waiting for the user – permission requests
 * (with decision), waiting agents (finished ones with direct reply), notices from the agents and
 * warnings when two agents edit the same file. Empty = invisible.
 */
function InboxPanel(props: Props): React.JSX.Element | null {
  const [replies, setReplies] = useState<Record<string, string>>({})
  const [denying, setDenying] = useState<{ id: number; reason: string } | null>(null)
  const t = useT()
  const name = (id?: string): string =>
    props.agents.find((a) => a.id === id)?.name ?? t('common.agent')
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
        {t('inbox.title')} <span className="count">{count}</span>
      </header>
      <div className="inbox-list">
        {props.permissions.map((p) => (
          <div key={`p${p.id}`} className="inbox-item permission">
            <div className="inbox-title" onClick={() => props.onSelectAgent(p.agentId)}>
              {withBold(t('inbox.permissionRequest'), { agent: name(p.agentId), tool: p.tool })}
            </div>
            <pre className="inbox-code">{p.summary}</pre>
            {denying?.id === p.id ? (
              <div className="inbox-reply">
                <input
                  autoFocus
                  value={denying.reason}
                  placeholder={t('inbox.denyPlaceholder')}
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
                  {t('common.deny')}
                </button>
              </div>
            ) : (
              <div className="inbox-actions">
                <button className="primary" onClick={() => props.onAnswer(p.id, 'allow')}>
                  {t('common.allow')}
                </button>
                <button onClick={() => setDenying({ id: p.id, reason: '' })}>
                  {t('common.deny')}
                </button>
                {p.rule && (
                  <button
                    title={t('inbox.alwaysTooltip', { rule: p.rule })}
                    onClick={() => props.onAnswer(p.id, 'always')}
                  >
                    {t('common.always')}
                  </button>
                )}
                <button
                  className="link"
                  title={t('inbox.inTerminalTooltip')}
                  onClick={() => props.onAnswer(p.id, 'terminal')}
                >
                  {t('inbox.inTerminal')}
                </button>
              </div>
            )}
          </div>
        ))}

        {waiting.map((a) => {
          // Direct reply only when the agent is done – with an open selection/question,
          // typed text would answer that instead
          // Legacy: agents saved before `turnDone` existed only have the (then German) status text
          const done = a.turnDone ?? (a.statusMessage ?? '').startsWith('Fertig')
          return (
            <div key={a.id} className="inbox-item">
              <div
                className="inbox-title"
                onClick={() => props.onSelectAgent(a.id)}
                title={
                  a.lastMessage
                    ? `${a.lastMessage}\n\n${t('inbox.clickShowAgent')}`
                    : t('inbox.showAgent')
                }
              >
                <strong>{a.name}</strong>
                <span className="muted">
                  {' '}
                  · {props.projects.find((p) => p.id === a.projectId)?.name}
                </span>
                <div className="inbox-sub">{a.statusMessage || t('inbox.waitingForInput')}</div>
              </div>
              {done && (
                <div className="inbox-reply">
                  <input
                    value={replies[a.id] ?? ''}
                    placeholder={t('inbox.replyPlaceholder', { name: a.name })}
                    onChange={(e) => setReplies((r) => ({ ...r, [a.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && reply(a)}
                  />
                  <button
                    className="icon"
                    title={t('common.send')}
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
              {withBold(t('inbox.conflict'), { agents: listOf(c.agentIds.map(name)) })}
              <div className="inbox-sub">{baseName(c.filePath)}</div>
            </div>
            <button
              className="icon inbox-close"
              title={t('inbox.dismiss')}
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
              title={t('inbox.dismiss')}
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
