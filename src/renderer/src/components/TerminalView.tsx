import { useEffect, useRef } from 'react'
import { attachSnapshot, attachTerminal, focusTerminal } from '../lib/terminals'

/**
 * Shows an agent's (long-lived) xterm terminal in this container.
 * `snapshot`: show the snapshot taken before the editor tab instead (see terminals.ts).
 */
function TerminalView({
  agentId,
  autoFocus,
  snapshot
}: {
  agentId: string
  autoFocus?: boolean
  snapshot?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    if (snapshot) return attachSnapshot(agentId, ref.current)
    const detach = attachTerminal(agentId, ref.current)
    if (autoFocus) focusTerminal(agentId)
    return detach
  }, [agentId, autoFocus, snapshot])

  return <div className="terminal-container" ref={ref} />
}

export default TerminalView
