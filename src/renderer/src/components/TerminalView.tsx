import { useEffect, useRef } from 'react'
import { attachSnapshot, attachTerminal, focusTerminal } from '../lib/terminals'

/**
 * Zeigt das (dauerhaft lebende) xterm-Terminal eines Agents in diesem Container an.
 * `snapshot`: stattdessen das Standbild von vor dem Editor-Tab (s. terminals.ts).
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
