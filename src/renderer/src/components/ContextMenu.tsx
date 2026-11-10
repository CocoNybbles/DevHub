import { useEffect } from 'react'

export interface MenuItem {
  label: string
  action: () => void
  danger?: boolean
}

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

/** Einfaches Kontextmenü an der Mausposition; schließt bei Klick daneben oder Esc. */
function ContextMenu({
  x,
  y,
  items,
  onClose
}: MenuState & { onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    const close = (): void => onClose()
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  return (
    <div
      className="context-menu"
      style={{
        left: Math.min(x, window.innerWidth - 180),
        top: Math.min(y, window.innerHeight - 120)
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          className={item.danger ? 'danger' : ''}
          onClick={() => {
            onClose()
            item.action()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export default ContextMenu
