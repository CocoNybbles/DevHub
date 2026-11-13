import { useCallback, useEffect, useState } from 'react'
import type { ClaudeAuthState } from '../../shared/types'
import AuthGate from './components/AuthGate'
import Workspace from './Workspace'

export type { Selection } from '../../shared/types'

/** Entry point: check the Claude login first, then show the workspace. */
function App(): React.JSX.Element {
  const [auth, setAuth] = useState<ClaudeAuthState | null>(null)
  const [checking, setChecking] = useState(false)

  const fetchAuth = useCallback(async (): Promise<ClaudeAuthState> => {
    try {
      return await window.api.claude.checkAuth()
    } catch (e) {
      return { kind: 'error', message: String(e) }
    }
  }, [])

  const recheck = useCallback(async () => {
    setChecking(true)
    setAuth(await fetchAuth())
    setChecking(false)
  }, [fetchAuth])

  // Check on app start
  useEffect(() => {
    fetchAuth().then(setAuth)
  }, [fetchAuth])

  if (!auth || auth.kind !== 'loggedIn') {
    return <AuthGate state={auth} checking={checking} onRecheck={recheck} />
  }

  return <Workspace />
}

export default App
