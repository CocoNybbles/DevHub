interface Props {
  value: string
  onChange: (value: string) => void
  /** Wird beim Verlassen des Feldes bzw. nach Auswahl/Zurücksetzen aufgerufen (z. B. speichern) */
  onCommit?: (value: string) => void
  /** Platzhalter, wenn leer – beschreibt, was dann verwendet wird */
  placeholder: string
}

/** Pfad zu einem Programm (.exe) mit Dateiauswahl; leer = Standard (siehe Platzhalter). */
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
