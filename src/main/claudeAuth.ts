import { exec, spawn } from 'child_process'
import type { ClaudeAuthState } from '../shared/types'

/**
 * Runs the Claude CLI via the shell, because on Windows `claude` can be an .exe or an
 * npm wrapper (.cmd) depending on how it was installed.
 * Only call with fixed, internally defined arguments (no user input).
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

/** Opens a visible console window with `claude auth login` (login happens in the browser). */
export function startClaudeLogin(): void {
  spawn('cmd.exe', ['/c', 'start', '"Claude Login"', 'cmd', '/k', 'claude auth login'], {
    detached: true,
    stdio: 'ignore',
    windowsVerbatimArguments: true
  }).unref()
}
