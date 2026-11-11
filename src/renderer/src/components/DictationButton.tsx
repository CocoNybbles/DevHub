import { useEffect, useRef, useState } from 'react'
import { Recorder } from '../lib/recorder'
import { errorText } from '../lib/errors'
import { MicIcon } from './Icons'

interface Props {
  /** Erkannter Text (wird z. B. an ein Textfeld angehängt) */
  onText: (text: string) => void
  /** Status-/Fehlertext für die Anzeige unter dem Feld; null = nichts anzeigen */
  onStatus: (status: { text: string; error?: boolean } | null) => void
}

/**
 * Mikrofon-Button zum Diktieren in ein Textfeld: Klick startet die Aufnahme, erneuter Klick
 * beendet sie; der Text wird lokal mit whisper erkannt (wie die Sprach-Anweisungen).
 */
function DictationButton({ onText, onStatus }: Props): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'recording' | 'processing'>('idle')
  const recorder = useRef<Recorder | null>(null)

  // Dialog geschlossen während der Aufnahme → Mikrofon freigeben
  useEffect(() => () => recorder.current?.cancel(), [])

  const toggle = async (): Promise<void> => {
    if (state === 'processing') return
    if (state === 'idle') {
      const status = await window.api.voice.status().catch(() => null)
      if (!status?.activeModel) {
        onStatus({
          text: 'Spracheingabe ist noch nicht eingerichtet (Einstellungen → Sprachmodell).',
          error: true
        })
        return
      }
      try {
        const rec = new Recorder()
        await rec.start()
        recorder.current = rec
        setState('recording')
        onStatus({ text: 'Aufnahme läuft … zum Beenden erneut auf das Mikrofon klicken.' })
      } catch (e) {
        onStatus({ text: `Mikrofon nicht verfügbar: ${errorText(e)}`, error: true })
      }
      return
    }

    const rec = recorder.current
    recorder.current = null
    setState('processing')
    onStatus({ text: 'Wandle in Text um …' })
    try {
      const wav = await rec?.stop()
      if (!wav) return onStatus({ text: 'Aufnahme zu kurz.', error: true })
      const { text } = await window.api.voice.transcribe(wav)
      if (!text) return onStatus({ text: 'Nichts verstanden.', error: true })
      onText(text)
      onStatus(null)
    } catch (e) {
      onStatus({ text: errorText(e), error: true })
    } finally {
      setState('idle')
    }
  }

  return (
    <button
      type="button"
      className={`icon dictation ${state === 'recording' ? 'recording' : ''}`}
      title={state === 'recording' ? 'Aufnahme beenden' : 'Diktieren'}
      disabled={state === 'processing'}
      onClick={toggle}
    >
      {state === 'processing' ? <span className="spinner" /> : <MicIcon />}
    </button>
  )
}

export default DictationButton
