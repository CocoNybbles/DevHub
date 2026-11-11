/** Kleine Inline-SVG-Icons (16px, folgen der Textfarbe). */

type P = { size?: number }

const svg = (size: number, children: React.ReactNode): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
)

export const PlusIcon = ({ size = 14 }: P): React.JSX.Element =>
  svg(size, <path d="M8 3v10M3 8h10" />)

export const PlayIcon = ({ size = 14 }: P): React.JSX.Element =>
  svg(size, <path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />)

export const CloseIcon = ({ size = 12 }: P): React.JSX.Element =>
  svg(size, <path d="M4 4l8 8M12 4l-8 8" />)

export const ChevronIcon = ({ size = 12 }: P): React.JSX.Element =>
  svg(size, <path d="M6 4l4 4-4 4" />)

export const MicIcon = ({ size = 14 }: P): React.JSX.Element =>
  svg(
    size,
    <>
      <rect x="6" y="2" width="4" height="8" rx="2" />
      <path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V14" />
    </>
  )

export const GearIcon = ({ size = 14 }: P): React.JSX.Element =>
  svg(
    size,
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </>
  )

/** Projektdatei öffnen (Dokument mit Pfeil nach außen – unabhängig vom Programm) */
export const OpenFileIcon = ({ size = 14 }: P): React.JSX.Element =>
  svg(
    size,
    <>
      <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V8" />
      <path d="M10.5 2H14v3.5M14 2L8 8" />
    </>
  )

/** Ordner im Editor öffnen; Code-Stelle in VS Code öffnen */
export const CodeIcon = ({ size = 14 }: P): React.JSX.Element =>
  svg(size, <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />)

/** Team (zwei Personen) */
/** A→Z mit Pfeil nach unten: alphabetisch aufsteigend sortieren */
export const SortIcon = ({ size = 14 }: P): React.JSX.Element =>
  svg(
    size,
    <>
      <path d="M2.5 7l2-5 2 5M3.2 5.3h2.6M2.5 9.5h4l-4 4.5h4" />
      <path d="M11.5 2.5v11M9 11l2.5 2.5L14 11" />
    </>
  )

export const CopyIcon = ({ size = 13 }: P): React.JSX.Element =>
  svg(
    size,
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </>
  )

export const CheckIcon = ({ size = 13 }: P): React.JSX.Element =>
  svg(size, <path d="M3 8.5l3.2 3L13 4.5" />)

/** Stift: Anweisung im Editor-Tab schreiben */
export const EditIcon = ({ size = 13 }: P): React.JSX.Element =>
  svg(size, <path d="M10.5 2.5l3 3L6 13H3v-3zM9 4l3 3" />)

export const LockIcon = ({ size = 13 }: P): React.JSX.Element =>
  svg(
    size,
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </>
  )

/** Büroklammer: Bild/Datei anhängen */
export const AttachIcon = ({ size = 13 }: P): React.JSX.Element =>
  svg(
    size,
    <path d="M13 7.5l-5.3 5.3a3 3 0 0 1-4.2-4.2L9 3.1a2 2 0 0 1 2.8 2.8L6.5 11.2a1 1 0 0 1-1.4-1.4L10 4.9" />
  )

export const SendIcon = ({ size = 13 }: P): React.JSX.Element =>
  svg(size, <path d="M2.5 8h9M8 4l4 4-4 4" />)

export const TeamIcon = ({ size = 13 }: P): React.JSX.Element =>
  svg(
    size,
    <>
      <circle cx="6" cy="5.5" r="2.2" />
      <path d="M2 13c0-2.2 1.8-3.8 4-3.8s4 1.6 4 3.8" />
      <circle cx="11.2" cy="6.2" r="1.7" />
      <path d="M11 9.4c1.7 0 3 1.3 3 3.1" />
    </>
  )

export const GridIcon = ({ size = 14 }: P): React.JSX.Element =>
  svg(
    size,
    <>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </>
  )
