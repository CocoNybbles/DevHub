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
        <button title="Standard verwenden" onClick={() => set('')}>
          Zurücksetzen
        </button>
      )}
      <button
        onClick={async () => {
          const p = await window.api.projects.pickProgram(value || undefined)
          if (p) set(p)
        }}
      >
        Durchsuchen …
      </button>
    </div>
  )
}

export default ProgramInput
