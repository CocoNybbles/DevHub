import { useEffect, useState } from 'react'
import type { Project } from '../../../shared/types'
import { errorText } from '../lib/errors'
import Markdown from './Markdown'
import Modal from './Modal'

interface Props {
  projects: Project[]
  onClose: () => void
}

/** Tagesbericht: Claude (Haiku) fasst zusammen, was die Agents heute getan haben und was offen ist. */
function ReportDialog({ projects, onClose }: Props): React.JSX.Element {
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
      title="Tagesbericht"
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
            {copied ? 'Kopiert' : 'Als Markdown kopieren'}
          </button>
          <button onClick={onClose}>Schließen</button>
        </>
      }
    >
      <div className="form">
        <label>
          <span>Projekt</span>
          <select
            value={projectId}
            onChange={(e) => {
              setReport(null)
              setError(null)
              setCopied(false)
              setProjectId(e.target.value)
            }}
          >
            <option value="">Alle Projekte</option>
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
        <p className="muted">Claude fasst den Tag zusammen …</p>
      ) : (
        <Markdown text={report} />
      )}
    </Modal>
  )
}

export default ReportDialog
