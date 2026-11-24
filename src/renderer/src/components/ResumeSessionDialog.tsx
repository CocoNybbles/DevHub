import { useEffect, useMemo, useState } from 'react'
import type { LocalSession, Project } from '../../../shared/types'
import { getLocale } from '../../../shared/i18n'
import { dateTimeOf } from '../lib/format'
import { errorText } from '../lib/errors'
import { useT } from '../lib/i18n'
import Modal from './Modal'

/** A transcript changed this recently may still be open in another terminal */
const RECENT_MS = 2 * 60_000

interface Props {
  project: Project
  /** Agent was started (or a running one chosen) → show it */
  onShowAgent: (agentId: string) => void
  onClose: () => void
}

/**
 * "Resume session …": the project's sessions that still exist on disk (also those started
 * outside DevHub), started as an agent with `claude --resume` or as a copy.
 */
function ResumeSessionDialog(props: Props): React.JSX.Element {
  const t = useT()
  const [sessions, setSessions] = useState<LocalSession[] | null>(null)
  /** When the list was loaded – for "was written to just now" */
  const [loadedAt, setLoadedAt] = useState(0)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.history
      .localSessions(props.project.id)
      .then((list) => {
        setLoadedAt(Date.now())
        setSessions(list)
      })
      .catch((e) => {
        setSessions([])
        setError(errorText(e))
      })
  }, [props.project.id])

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!sessions || !needle) return sessions ?? []
    return sessions.filter((s) =>
      [s.title, s.firstPrompt, s.lastPrompt, s.name, s.branch, s.sessionId].some((x) =>
        x?.toLowerCase().includes(needle)
      )
    )
  }, [sessions, filter])

  /** Written to just now, not by a running agent and not just ended in DevHub: probably running elsewhere */
  const activeElsewhere = (s: LocalSession): boolean =>
    !s.agentId &&
    loadedAt - s.updatedAt < RECENT_MS &&
    !(s.endedAt && s.endedAt >= s.updatedAt - 5000)

  const resume = async (s: LocalSession, fork: boolean): Promise<void> => {
    // Two claude processes would write into the same transcript
    if (!fork && activeElsewhere(s) && !confirm(t('history.localConfirmActive'))) return
    setError(null)
    setBusy(s.sessionId)
    try {
      const agent = await window.api.history.resumeSession(props.project.id, s.sessionId, fork)
      props.onShowAgent(agent.id)
      props.onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const size = (bytes: number): string =>
    t('history.localSize', {
      size: (bytes / 1e6).toLocaleString(getLocale(), { maximumFractionDigits: 1 })
    })

  const entry = (s: LocalSession): React.JSX.Element => {
    const heading = s.title ?? s.firstPrompt ?? t('history.noInstruction')
    // Second line: the first instruction under a title, otherwise the latest one
    const detail = s.title ? s.firstPrompt : s.lastPrompt !== s.firstPrompt ? s.lastPrompt : ''
    const meta = [
      dateTimeOf(s.updatedAt),
      size(s.size),
      s.branch && t('history.localWorktree', { branch: s.branch }),
      s.agentId
        ? t('history.localRunningAs', { name: s.name ?? '' })
        : s.name && t('history.localInHistoryAs', { name: s.name })
    ].filter(Boolean)
    return (
      <div
        key={s.sessionId}
        className="history-item"
        title={t('history.localItemTooltip', { id: s.sessionId, cwd: s.cwd })}
      >
        <div className="history-info">
          <div className="history-heading">
            <strong>{heading}</strong>
          </div>
          <div className="muted small">
            {meta.join(' · ')}
            {activeElsewhere(s) && (
              <span className="session-recent"> · {t('history.localRecent')}</span>
            )}
            {s.team && (
              <span className="session-recent" title={t('history.localTeamTooltip')}>
                {' '}
                · {t('history.localTeam')}
              </span>
            )}
          </div>
          {detail && <div className="history-title">{detail}</div>}
        </div>
        {s.agentId ? (
          <button
            onClick={() => {
              props.onShowAgent(s.agentId!)
              props.onClose()
            }}
          >
            {t('history.show')}
          </button>
        ) : (
          <button
            disabled={busy !== null}
            onClick={() => resume(s, false)}
            title={t('history.localResumeTooltip')}
          >
            {busy === s.sessionId ? t('history.localStarting') : t('history.resume')}
          </button>
        )}
        <button
          disabled={busy !== null}
          onClick={() => resume(s, true)}
          title={t('history.localForkTooltip')}
        >
          {t('history.fork')}
        </button>
      </div>
    )
  }

  return (
    <Modal
      title={t('history.localTitle', { project: props.project.name })}
      onClose={props.onClose}
      width={Math.min(900, window.innerWidth - 60)}
      footer={<button onClick={props.onClose}>{t('common.close')}</button>}
    >
      <div className="path-input">
        <input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('history.localFilter')}
        />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="history-list">
        {sessions === null && <p className="muted">{t('history.localLoading')}</p>}
        {sessions?.length === 0 && !error && <p className="muted">{t('history.localEmpty')}</p>}
        {sessions && sessions.length > 0 && shown.length === 0 && (
          <p className="muted">{t('history.noMatches')}</p>
        )}
        {shown.map(entry)}
      </div>
      <p className="muted small">{t('history.localHelp')}</p>
    </Modal>
  )
}

export default ResumeSessionDialog
