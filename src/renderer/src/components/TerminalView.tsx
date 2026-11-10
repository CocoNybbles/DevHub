import { useEffect, useRef } from 'react'
import { attachTerminal, focusTerminal } from '../lib/terminals'

/** Zeigt das (dauerhaft lebende) xterm-Terminal eines Agents in diesem Container an. */
function TerminalView({
  agentId,
  autoFocus
}: {
  agentId: string
  autoFocus?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const detach = attachTerminal(agentId, ref.current)
    if (autoFocus) focusTerminal(agentId)
    return detach
  }, [agentId, autoFocus])

  return <div className="terminal-container" ref={ref} />
}

export default TerminalView
