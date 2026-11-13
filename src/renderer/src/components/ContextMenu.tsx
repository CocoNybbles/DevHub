import { useEffect } from 'react'

export interface MenuItem {
  label: string
  action: () => void
  danger?: boolean
  /** Check mark (undefined = not a checkable entry) */
  checked?: boolean
  /** Non-clickable subheading (action is ignored) */
  heading?: boolean
}

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

/** Simple context menu at the mouse position; closes on click outside or Esc. */
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
        left: Math.min(x, window.innerWidth - 260),
        top: Math.min(y, window.innerHeight - 16 - items.length * 30)
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item) =>
        item.heading ? (
          <div key={item.label} className="menu-heading">
            {item.label}
          </div>
        ) : (
          <button
            key={item.label}
            className={item.danger ? 'danger' : ''}
            onClick={() => {
              onClose()
              item.action()
            }}
          >
            {item.checked !== undefined && (
              <span className="menu-check">{item.checked ? '✓' : ''}</span>
            )}
            {item.label}
          </button>
        )
      )}
    </div>
  )
}

export default ContextMenu
