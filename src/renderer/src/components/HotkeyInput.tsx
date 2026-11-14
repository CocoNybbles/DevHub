import { useEffect, useRef, useState } from 'react'
import { acceleratorFromEvent, formatAccelerator } from '../../../shared/hotkeys'
import { errorText } from '../lib/errors'
import { setCapturingHotkey } from '../lib/hotkeyCapture'
import { useT } from '../lib/i18n'

interface Props {
  value: string
  defaultValue: string
  /** Global shortcut: release it system-wide while capturing so it can be pressed again */
  global?: boolean
  /** Saves the new shortcut; errors are shown below the field */
  onChange: (accelerator: string) => Promise<void>
}

const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/

/** Shortcut field: click "Change", then press the key combination (Esc cancels). */
function HotkeyInput({ value, defaultValue, global, onChange }: Props): React.JSX.Element {
  const t = useT()
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Current values via ref: a parent re-render must not restart the running capture
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
      else setHint(t('settings.hotkeyNeedsModifier'))
    }
    // Capture phase: before Modal (Esc would otherwise close the dialog) and all other hotkeys
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    const onBlur = (): void => void finish(null)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
      window.removeEventListener('blur', onBlur)
      setCapturingHotkey(false)
      // after saving or cancelling, re-register the (possibly new) saved shortcut
      if (global) window.api.settings.suspendGlobalHotkey(false)
    }
  }, [recording, global, t])

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
          <kbd className="recording">{t('settings.hotkeyPress')}</kbd>
        ) : (
          <kbd>{formatAccelerator(value)}</kbd>
        )}
        {!recording && (
          <>
            <button className="link" onClick={start}>
              {t('settings.hotkeyChange')}
            </button>
            {value !== defaultValue && (
              <button className="link" onClick={reset} title={formatAccelerator(defaultValue)}>
                {t('common.default')}
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
