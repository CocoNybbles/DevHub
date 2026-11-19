import type { ClaudeAuthState } from '../../../shared/types'
import { useT } from '../lib/i18n'

interface Props {
  state: ClaudeAuthState | null
  checking: boolean
  onRecheck: () => void
}

/** Start screen: blocks the app until Claude Code is installed and logged in. */
function AuthGate({ state, checking, onRecheck }: Props): React.JSX.Element {
  const t = useT()

  if (!state) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1>DevHub</h1>
          <p className="muted">{t('auth.checkingLogin')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <h1>DevHub</h1>

        {state.kind === 'notInstalled' && (
          <>
            <h2>{t('auth.notInstalledTitle')}</h2>
            <p>{t('auth.notInstalledText')}</p>
            <p className="muted">
              {t('auth.instructions')} <code>docs.claude.com/claude-code</code>
            </p>
          </>
        )}

        {state.kind === 'loggedOut' && (
          <>
            <h2>{t('auth.loggedOutTitle')}</h2>
            <p>
              {state.reason ?? t('auth.notLoggedIn')} {t('auth.loginFirst')}
            </p>
            <button className="primary" onClick={() => window.api.claude.startLogin()}>
              {t('auth.loginButton')}
            </button>
            <p className="muted small">
              {t('auth.loginHintBefore')} <code>claude auth login</code>
              {t('auth.loginHintAfter')}
            </p>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <h2>{t('auth.checkFailedTitle')}</h2>
            <p className="error">{state.message}</p>
          </>
        )}

        <button onClick={onRecheck} disabled={checking}>
          {checking ? t('auth.checking') : t('auth.recheck')}
        </button>
      </div>
    </div>
  )
}

export default AuthGate
