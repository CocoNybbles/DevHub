import type { ClaudeAuthState } from '../../../shared/types'

interface Props {
  state: ClaudeAuthState | null
  checking: boolean
  onRecheck: () => void
}

/** Start screen: blocks the app until Claude Code is installed and logged in. */
function AuthGate({ state, checking, onRecheck }: Props): React.JSX.Element {
  if (!state) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1>DevHub</h1>
          <p className="muted">Prüfe Claude-Anmeldung …</p>
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
            <h2>Claude Code wurde nicht gefunden</h2>
            <p>
              DevHub benötigt die Claude-Code-CLI. Bitte installiere sie und starte danach die
              Prüfung erneut.
            </p>
            <p className="muted">
              Anleitung: <code>docs.claude.com/claude-code</code>
            </p>
          </>
        )}

        {state.kind === 'loggedOut' && (
          <>
            <h2>Bitte bei Claude anmelden</h2>
            <p>
              {state.reason ?? 'Du bist aktuell nicht bei Claude angemeldet.'} Melde dich zuerst an,
              danach geht es weiter.
            </p>
            <button className="primary" onClick={() => window.api.claude.startLogin()}>
              Anmelden …
            </button>
            <p className="muted small">
              Es öffnet sich ein Konsolenfenster mit <code>claude auth login</code>. Nach dem Login
              hier auf „Erneut prüfen“ klicken.
            </p>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <h2>Prüfung fehlgeschlagen</h2>
            <p className="error">{state.message}</p>
          </>
        )}

        <button onClick={onRecheck} disabled={checking}>
          {checking ? 'Prüfe …' : 'Erneut prüfen'}
        </button>
      </div>
    </div>
  )
}

export default AuthGate
