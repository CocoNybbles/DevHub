import { useEffect, useState } from 'react'
import type { Project } from '../../../shared/types'
import { errorText } from '../lib/errors'
import { useT } from '../lib/i18n'
import Markdown from './Markdown'
import Modal from './Modal'

interface Props {
  projects: Project[]
  onClose: () => void
}

/** Daily report: Claude (Haiku) summarizes what the agents did today and what is still open. */
function ReportDialog({ projects, onClose }: Props): React.JSX.Element {
  const t = useT()
  const [projectId, setProjectId] = useState('')
  const [report, setReport] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.reports
      .daily(projectId || undefined)
      .then((text) => !cancelled && setReport(text))
      .catch((e) => !cancelled && setError(errorText(e)))
    return () => {
      cancelled = true
    }
  }, [projectId])

  return (
    <Modal
      title={t('report.title')}
      onClose={onClose}
      width={720}
      footer={
        <>
          <button
            disabled={!report}
            onClick={async () => {
              await window.api.clipboard.writeText(report ?? '')
              setCopied(true)
            }}
          >
            {copied ? t('common.copied') : t('report.copyMarkdown')}
          </button>
          <button onClick={onClose}>{t('common.close')}</button>
        </>
      }
    >
      <div className="form">
        <label>
          <span>{t('common.project')}</span>
          <select
            value={projectId}
            onChange={(e) => {
              setReport(null)
              setError(null)
              setCopied(false)
              setProjectId(e.target.value)
            }}
          >
            <option value="">{t('report.allProjects')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <p className="error">{error}</p>
      ) : report === null ? (
        <p className="muted">{t('report.loading')}</p>
      ) : (
        <Markdown text={report} />
      )}
    </Modal>
  )
}

export default ReportDialog
