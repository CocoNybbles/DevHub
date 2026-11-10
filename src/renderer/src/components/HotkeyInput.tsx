import { useEffect, useRef, useState } from 'react'
import { acceleratorFromEvent, formatAccelerator } from '../../../shared/hotkeys'
import { errorText } from '../lib/errors'
import { setCapturingHotkey } from '../lib/hotkeyCapture'

interface Props {
  value: string
  defaultValue: string
  /** Globales Kürzel: während der Aufnahme systemweit freigeben, damit es neu gedrückt werden kann */
  global?: boolean
  /** Speichert das neue Kürzel; Fehler werden unter dem Feld angezeigt */
  onChange: (accelerator: string) => Promise<void>
}

const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/

/** Kürzel-Feld: Klick auf „Ändern“, dann Tastenkombination drücken (Esc bricht ab). */
function HotkeyInput({ value, defaultValue, global, onChange }: Props): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Aktuelle Werte per Ref: Re-Render des Elternteils darf die laufende Aufnahme nicht neu starten
  const latest = useRef({ value, onChange })
  useEffect(() => {
    latest.current = { value, onChange }
  })

  useEffect(() => {
    if (!recording) return
    setCapturingHotkey(true)
    if (global) window.api.settings.suspendGlobalHotkey(true)

    let done = false
    const finish = async (accelerator: string | null): Promise<void> => {
      if (done) return
      done = true
      setRecording(false)
      try {
        if (accelerator && accelerator !== latest.current.value)
          await latest.current.onChange(accelerator)
      } catch (e) {
        setError(errorText(e))
      }
    }

    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.type !== 'keydown' || MODIFIER_CODES.test(e.code)) return
      if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        finish(null)
        return
      }
      const acc = acceleratorFromEvent(e)
      if (acc) finish(acc)
      else setHint('Mit Strg, Alt oder Win kombinieren (oder eine F-Taste verwenden)')
    }
    // Capture-Phase: vor Modal (Esc schließt sonst den Dialog) und allen anderen Hotkeys
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    const onBlur = (): void => void finish(null)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
      window.removeEventListener('blur', onBlur)
      setCapturingHotkey(false)
      // nach dem Speichern bzw. Abbruch wieder das (ggf. neue) gespeicherte Kürzel registrieren
      if (global) window.api.settings.suspendGlobalHotkey(false)
    }
  }, [recording, global])

  const start = (): void => {
    setHint(null)
    setError(null)
    setRecording(true)
  }

  const reset = async (): Promise<void> => {
    setError(null)
    try {
      await onChange(defaultValue)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="hotkey-input">
      <div className="hotkey-row">
        {recording ? (
          <kbd className="recording">Tastenkombination drücken … (Esc = Abbrechen)</kbd>
        ) : (
          <kbd>{formatAccelerator(value)}</kbd>
        )}
        {!recording && (
          <>
            <button className="link" onClick={start}>
              Ändern
            </button>
            {value !== defaultValue && (
              <button className="link" onClick={reset} title={formatAccelerator(defaultValue)}>
                Standard
              </button>
            )}
          </>
        )}
      </div>
      {recording && hint && <div className="muted small">{hint}</div>}
      {error && <div className="error small">{error}</div>}
    </div>
  )
}

export default HotkeyInput
