import { useEffect } from 'react'

interface Props {
  title: string
  onClose?: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number
}

function Modal({ title, onClose, children, footer, width = 520 }: Props): React.JSX.Element {
  useEffect(() => {
    if (!onClose) return
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ width }} role="dialog" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  )
}

export default Modal
