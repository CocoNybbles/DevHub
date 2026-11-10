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

/** Visual Studio (Projektmappe öffnen) */
export const VsIcon = ({ size = 14 }: P): React.JSX.Element =>
  svg(
    size,
    <>
      <path d="M11 2l3 1.5v9L11 14 4.5 8z" />
      <path d="M2 5.5L4.5 8 2 10.5z" />
    </>
  )

/** VS Code (Ordner öffnen) */
export const CodeIcon = ({ size = 14 }: P): React.JSX.Element =>
  svg(size, <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />)

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
