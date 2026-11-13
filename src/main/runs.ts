import { ChildProcess, execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import type { Project, RunInfo } from '../shared/types'

/** Keep at most this much output per command (the end) */
const MAX_OUTPUT = 300_000

interface Run {
  info: RunInfo
  proc?: ChildProcess
  output: string
}

export interface RunEvents {
  onChanged: (projectId: string) => void
  onOutput: (projectId: string, name: string, chunk: string) => void
}

/** CSI, OSC and simple ESC sequences (output is shown as plain text) */
const ANSI =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>]/g

/**
 * Project commands (dev server, tests …) as managed processes: start, stop, record the
 * output. Agents read the output via MCP tools (`run_output`).
 */
export class RunManager {
  private runs = new Map<string, Run>()

  constructor(private events: RunEvents) {}

  private key = (projectId: string, name: string): string =>
    `${projectId}\n${name.trim().toLowerCase()}`

  /** The project's commands with their state */
  list(project: Project): RunInfo[] {
    return (project.runCommands ?? []).map((c) => {
      const run = this.runs.get(this.key(project.id, c.name))
      return run
        ? { ...run.info, command: c.command }
        : { projectId: project.id, name: c.name, command: c.command, running: false }
    })
  }

  start(project: Project, name: string): void {
    const cmd = (project.runCommands ?? []).find(
      (c) => c.name.trim().toLowerCase() === name.trim().toLowerCase()
    )
    if (!cmd) throw new Error(`Befehl „${name}“ ist für ${project.name} nicht eingerichtet`)
    if (!existsSync(project.agentPath)) throw new Error(`Ordner fehlt: ${project.agentPath}`)
    const key = this.key(project.id, cmd.name)
    if (this.runs.get(key)?.info.running) return

    const run: Run = {
      info: {
        projectId: project.id,
        name: cmd.name,
        command: cmd.command,
        running: true,
        startedAt: Date.now()
      },
      output: ''
    }
    this.runs.set(key, run)
    // The user's command line → via the shell (one string, no argument list)
    const proc = spawn(cmd.command, {
      cwd: project.agentPath,
      shell: true,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
    })
    run.proc = proc
    const add = (data: Buffer): void => {
      const chunk = data.toString('utf8').replace(ANSI, '')
      run.output = (run.output + chunk).slice(-MAX_OUTPUT)
      this.events.onOutput(project.id, cmd.name, chunk)
    }
    proc.stdout?.on('data', add)
    proc.stderr?.on('data', add)
    const finish = (code: number | null, note?: string): void => {
      if (!run.info.running) return
      run.info.running = false
      run.info.exitCode = code
      run.proc = undefined
      if (note) add(Buffer.from(note))
      this.events.onChanged(project.id)
    }
    proc.on('error', (e) => finish(null, `\n[DevHub] Start fehlgeschlagen: ${e.message}\n`))
    proc.on('close', (code) => finish(code, `\n[DevHub] beendet mit Code ${code ?? '?'}\n`))
    this.events.onChanged(project.id)
  }

  stop(projectId: string, name: string): void {
    const run = this.runs.get(this.key(projectId, name))
    if (run?.proc?.pid) killTree(run.proc.pid)
  }

  output(projectId: string, name: string): string {
    return this.runs.get(this.key(projectId, name))?.output ?? ''
  }

  stopAll(): void {
    for (const run of this.runs.values()) if (run.proc?.pid) killTree(run.proc.pid)
  }
}

/** Kills the process including child processes (the shell starts the actual program). */
function killTree(pid: number): void {
  execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
}
