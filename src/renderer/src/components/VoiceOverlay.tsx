import { MicIcon } from './Icons'

/** Laufende Aufnahme (höchstens eine gleichzeitig). */
export interface VoiceRecording {
  target: 'agent' | 'global'
  label: string
  startedAt: number
}

/** Eine Aufnahme, die im Hintergrund erkannt/verarbeitet wird – mehrere gleichzeitig möglich. */
export interface VoiceJob {
  id: number
  state: 'processing' | 'done' | 'error'
  /** z. B. „Wandle in Text um …“ oder das Ergebnis */
  message: string
  /** Wer angesprochen wurde („Agent 2“, „Sprachbefehl“) */
  target: string
  text?: string
  /** Erkannte Sprache (whisper-Code, z. B. „de“) */
  language?: string
}

interface Props {
  recording: VoiceRecording | null
  jobs: VoiceJob[]
  onStop: () => void
  onCancel: () => void
  onDismiss: (jobId: number) => void
}

/**
 * Schwebende Anzeige unten in der Mitte: Aufnahme + Hintergrund-Aufträge.
 * Blockiert die App nicht – nur die Karten selbst sind klickbar.
 */
function VoiceOverlay({
  recording,
  jobs,
  onStop,
  onCancel,
  onDismiss
}: Props): React.JSX.Element | null {
  if (!recording && jobs.length === 0) return null

  return (
    <div className="voice-stack">
      {jobs.map((job) => (
        <div
          key={job.id}
          className={`voice-overlay ${job.state === 'error' ? 'error' : ''} ${job.state === 'processing' ? 'processing' : ''}`}
        >
          {job.state === 'processing' && <span className="spinner" />}
          <span className="voice-text">
            <span className="muted">
              {job.target}
              {job.language && ` [${job.language.toUpperCase()}]`}:{' '}
            </span>
            {job.text && <span className="muted">„{job.text}“ </span>}
            <strong>{job.message}</strong>
          </span>
          {job.state !== 'processing' && <button onClick={() => onDismiss(job.id)}>OK</button>}
        </div>
      ))}
      {recording && (
        <div className="voice-overlay recording">
          <span className="rec-dot" />
          <span className="voice-text">
            <strong>Aufnahme</strong> · {recording.label}
          </span>
          <button className="primary" onClick={onStop}>
            <MicIcon /> Fertig
          </button>
          <button onClick={onCancel}>Abbrechen</button>
        </div>
      )}
    </div>
  )
}

export default VoiceOverlay
