import { exec, spawn } from 'child_process'
import type { ClaudeAuthState } from '../shared/types'

/**
 * Führt die Claude-CLI über die Shell aus, weil `claude` unter Windows je nach
 * Installationsart eine .exe oder ein npm-Wrapper (.cmd) sein kann.
 * Nur mit festen, intern definierten Argumenten aufrufen (keine Nutzereingaben).
 */
function runClaude(
  args: string[],
  timeoutMs = 15000
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(
      ['claude', ...args].join(' '),
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0
        resolve({ code, stdout: stdout.toString(), stderr: stderr.toString() })
      }
    )
  })
}

export async function checkClaudeAuth(): Promise<ClaudeAuthState> {
  const version = await runClaude(['--version'])
  if (version.code !== 0) return { kind: 'notInstalled' }

  const status = await runClaude(['auth', 'status', '--json'])
  try {
    const data = JSON.parse(status.stdout)
    if (!data.loggedIn) return { kind: 'loggedOut' }

    if (data.loginExpiresAt && new Date(data.loginExpiresAt).getTime() <= Date.now()) {
      return { kind: 'loggedOut', reason: 'Die Anmeldung ist abgelaufen.' }
    }
    return {
      kind: 'loggedIn',
      authMethod: data.authMethod,
      loginExpiresAt: data.loginExpiresAt,
      subscriptionType: data.subscriptionType
    }
  } catch {
    if (status.code !== 0) return { kind: 'loggedOut' }
    return {
      kind: 'error',
      message: 'Antwort von `claude auth status` konnte nicht gelesen werden.'
    }
  }
}

/** Öffnet ein sichtbares Konsolenfenster mit `claude auth login` (Login läuft über den Browser). */
export function startClaudeLogin(): void {
  spawn('cmd.exe', ['/c', 'start', '"Claude Login"', 'cmd', '/k', 'claude auth login'], {
    detached: true,
    stdio: 'ignore',
    windowsVerbatimArguments: true
  }).unref()
}
