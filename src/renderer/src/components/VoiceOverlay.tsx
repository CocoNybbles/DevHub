import { MicIcon } from './Icons'

export type VoiceUi =
  | { mode: 'idle' }
  | { mode: 'recording'; target: 'agent' | 'global'; label: string; startedAt: number }
  | { mode: 'processing'; label: string; text?: string }
  | { mode: 'result'; text?: string; message: string; error?: boolean }

interface Props {
  ui: VoiceUi
  onStop: () => void
  onCancel: () => void
  onDismiss: () => void
}

/** Schwebende Anzeige unten in der Mitte während Aufnahme/Verarbeitung/Ergebnis. */
function VoiceOverlay({ ui, onStop, onCancel, onDismiss }: Props): React.JSX.Element | null {
  if (ui.mode === 'idle') return null

  return (
    <div className={`voice-overlay ${ui.mode} ${ui.mode === 'result' && ui.error ? 'error' : ''}`}>
      {ui.mode === 'recording' && (
        <>
          <span className="rec-dot" />
          <span className="voice-text">
            <strong>Aufnahme</strong> · {ui.label}
          </span>
          <button className="primary" onClick={onStop}>
            <MicIcon /> Fertig
          </button>
          <button onClick={onCancel}>Abbrechen</button>
        </>
      )}
      {ui.mode === 'processing' && (
        <>
          <span className="spinner" />
          <span className="voice-text">
            <strong>{ui.label}</strong>
            {ui.text && <span className="muted"> „{ui.text}“</span>}
          </span>
        </>
      )}
      {ui.mode === 'result' && (
        <>
          <span className="voice-text">
            {ui.text && <span className="muted">„{ui.text}“ </span>}
            <strong>{ui.message}</strong>
          </span>
          <button onClick={onDismiss}>OK</button>
        </>
      )}
    </div>
  )
}

export default VoiceOverlay
