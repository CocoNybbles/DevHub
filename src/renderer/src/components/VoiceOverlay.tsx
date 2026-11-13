import { MicIcon } from './Icons'

/** Running recording (at most one at a time). */
export interface VoiceRecording {
  target: 'agent' | 'global'
  /** For target 'agent': which agent is being recorded for */
  agentId?: string
  label: string
  startedAt: number
}

/** A recording being recognized/processed in the background – several at once are possible. */
export interface VoiceJob {
  id: number
  state: 'processing' | 'done' | 'error'
  /** e.g. "Wandle in Text um …" or the result */
  message: string
  /** Who was addressed ("Agent 2", "Sprachbefehl") */
  target: string
  text?: string
  /** Detected language (whisper code, e.g. "de") */
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
 * Floating display at the bottom center: recording + background jobs.
 * Does not block the app – only the cards themselves are clickable.
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
