import { useT } from '../lib/i18n'

interface Props {
  value: string
  onChange: (value: string) => void
  /** Called when leaving the field or after picking/resetting (e.g. to save) */
  onCommit?: (value: string) => void
  /** Placeholder when empty – describes what is used instead */
  placeholder: string
}

/** Path to a program (.exe) with file picker; empty = default (see placeholder). */
function ProgramInput({ value, onChange, onCommit, placeholder }: Props): React.JSX.Element {
  const t = useT()
  const set = (v: string): void => {
    onChange(v)
    onCommit?.(v)
  }

  return (
    <div className="path-input">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit?.(value)}
        placeholder={placeholder}
        spellCheck={false}
      />
      {value && (
        <button title={t('settings.programUseDefault')} onClick={() => set('')}>
          {t('settings.programReset')}
        </button>
      )}
      <button
        onClick={async () => {
          const p = await window.api.projects.pickProgram(value || undefined)
          if (p) set(p)
        }}
      >
        {t('common.browse')}
      </button>
    </div>
  )
}

export default ProgramInput
