import { useEffect, useMemo, useState } from 'react'
import type {
  Agent,
  ArchivedSession,
  Project,
  SessionMatch,
  Settings,
  TokenTotals
} from '../../../shared/types'
import {
  addTotals,
  costOf,
  dateTimeOf,
  formatCost,
  formatTokens,
  localDay,
  zeroTotals
} from '../lib/format'
import { errorText } from '../lib/errors'
import { useT } from '../lib/i18n'
import Modal from './Modal'

interface Props {
  projects: Project[]
  agents: Agent[]
  settings: Settings
  /** Session was resumed as an agent, or a running agent was selected → show it */
  onShowAgent: (agentId: string) => void
  onClose: () => void
}

interface UsageRow {
  today: TokenTotals
  total: TokenTotals
}

/** Usage per project across running agents and ended sessions */
function usageByProject(
  sessions: { projectId: string; usage?: Agent['usage'] }[],
  today: string
): [string, UsageRow][] {
  const rows = new Map<string, UsageRow>()
  for (const s of sessions) {
    if (!s.usage) continue
    const row = rows.get(s.projectId) ?? { today: zeroTotals(), total: zeroTotals() }
    rows.set(s.projectId, {
      today: addTotals(row.today, s.usage.byDay[today]),
      total: addTotals(row.total, s.usage.total)
    })
  }
  return [...rows.entries()]
}

/**
 * History: resume ended sessions or fork them as a copy, full-text search across all
 * transcripts (running and ended) and the token usage per project (today / total).
 */
function HistoryDialog(props: Props): React.JSX.Element {
  const t = useT()
  const [archive, setArchive] = useState<ArchivedSession[]>([])
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<SessionMatch[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const projectName = (id: string): string =>
    props.projects.find((p) => p.id === id)?.name ?? t('history.removedProject')

  useEffect(() => {
    window.api.history.list().then(setArchive)
  }, [])

  const search = async (): Promise<void> => {
    if (query.trim().length < 2) return setMatches(null)
    setSearching(true)
    setError(null)
    try {
      setMatches(await window.api.history.search(query))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSearching(false)
    }
  }

  const resume = async (id: string, fork: boolean): Promise<void> => {
    setError(null)
    try {
      const agent = await window.api.history.resume(id, fork)
      props.onShowAgent(agent.id)
      props.onClose()
    } catch (e) {
      setError(errorText(e))
    }
  }

  // Usage per project: running agents + ended sessions
  const [today] = useState(() => localDay(Date.now()))
  const usage = useMemo(
    () => usageByProject([...props.agents, ...archive], today),
    [props.agents, archive, today]
  )

  const tokens = (totals: TokenTotals): string => {
    const cost = costOf(totals, props.settings)
    const input = formatTokens(totals.input + totals.cacheRead + totals.cacheWrite)
    const output = formatTokens(totals.output)
    return cost !== null
      ? t('history.usageWithCost', { input, output, cost: formatCost(cost) })
      : t('history.usage', { input, output })
  }

  const entry = (s: ArchivedSession): React.JSX.Element => (
    <div key={s.id} className="history-item">
      <div className="history-info">
        <div>
          <strong>{s.name}</strong>
          <span className="muted">
            {' '}
            {s.worktree
              ? t('history.entryMetaWorktree', {
                  project: projectName(s.projectId),
                  date: dateTimeOf(s.endedAt),
                  branch: s.worktree.branch
                })
              : t('history.entryMeta', {
                  project: projectName(s.projectId),
                  date: dateTimeOf(s.endedAt)
                })}
          </span>
        </div>
        <div className="history-title">{s.title ?? t('history.noInstruction')}</div>
      </div>
      <button onClick={() => resume(s.id, false)} title={t('history.resumeTooltip')}>
        {t('history.resume')}
      </button>
      <button onClick={() => resume(s.id, true)} title={t('history.forkTooltip')}>
        {t('history.fork')}
      </button>
      <button
        className="link danger"
        title={t('history.removeTooltip')}
        onClick={async () => {
          await window.api.history.remove(s.id)
          setArchive(await window.api.history.list())
        }}
      >
        {t('history.remove')}
      </button>
    </div>
  )

  return (
    <Modal
      title={t('history.title')}
      onClose={props.onClose}
      width={Math.min(900, window.innerWidth - 60)}
      footer={<button onClick={props.onClose}>{t('common.close')}</button>}
    >
      <div className="path-input">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder={t('history.searchPlaceholder')}
        />
        <button onClick={search} disabled={searching || query.trim().length < 2}>
          {searching ? t('history.searching') : t('history.search')}
        </button>
        {matches && (
          <button
            onClick={() => {
              setMatches(null)
              setQuery('')
            }}
          >
            {t('history.back')}
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      {matches ? (
        <div className="history-list">
          {matches.length === 0 && <p className="muted">{t('history.noMatches')}</p>}
          {matches.map((m) => {
            const archived = archive.find((x) => x.id === m.archivedId)
            return (
              <div key={m.sessionId} className="history-item">
                <div className="history-info">
                  <div>
                    <strong>{m.name}</strong>
                    <span className="muted">
                      {' '}
                      {t(m.agentId ? 'history.matchMetaRunning' : 'history.matchMetaEnded', {
                        project: projectName(m.projectId)
                      })}
                    </span>
                  </div>
                  {m.excerpts.map((x, i) => (
                    <div key={i} className="history-excerpt">
                      {x}
                    </div>
                  ))}
                </div>
                {m.agentId ? (
                  <button
                    onClick={() => {
                      props.onShowAgent(m.agentId!)
                      props.onClose()
                    }}
                  >
                    {t('history.show')}
                  </button>
                ) : (
                  archived && (
                    <button onClick={() => resume(archived.id, false)}>
                      {t('history.resume')}
                    </button>
                  )
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <>
          {usage.length > 0 && (
            <section className="settings-section">
              <h3>{t('history.usageHeading')}</h3>
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>{t('common.project')}</th>
                    <th>{t('history.usageToday')}</th>
                    <th>{t('history.usageTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map(([projectId, row]) => (
                    <tr key={projectId}>
                      <td>{projectName(projectId)}</td>
                      <td>{tokens(row.today)}</td>
                      <td>{tokens(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {costOf(zeroTotals(), props.settings) === null && (
                <small className="muted">{t('history.costHint')}</small>
              )}
            </section>
          )}
          <section className="settings-section">
            <h3>{t('history.endedHeading')}</h3>
            <div className="history-list">
              {archive.length === 0 && <p className="muted">{t('history.endedEmpty')}</p>}
              {archive.map(entry)}
            </div>
          </section>
        </>
      )}
    </Modal>
  )
}

export default HistoryDialog
