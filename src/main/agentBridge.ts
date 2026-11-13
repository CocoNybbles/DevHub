import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import type { AddressInfo } from 'net'

/**
 * Lokaler HTTP-Server (nur 127.0.0.1) als Rückkanal von den Agents zur App:
 *  - POST /hook/<token>/<agentId>  → Claude-Code-Hooks (per curl, Hook-JSON im Body)
 *  - POST /editor/<token>/<agentId> → Strg+G-Editor (Body = Pfad der Prompt-Datei, bleibt offen)
 *  - POST /permission/<token>/<agentId> → PermissionRequest-Hook eines Team-Workers: bleibt offen,
 *                                    bis der Orchestrator entschieden hat; Antwort = Hook-JSON
 *  - POST /mcp/<token>/<agentId>   → minimaler MCP-Server (Streamable HTTP, JSON-Antworten)
 *                                    mit `show_code` und – nur für Teammitglieder –
 *                                    `team_members` / `send_team_message`, für den Orchestrator
 *                                    zusätzlich `answer_permission`
 * Das zufällige Token verhindert, dass andere lokale Prozesse Ereignisse einschleusen.
 */

export interface HookEvent {
  hook_event_name?: string
  tool_name?: string
  message?: string
  notification_type?: string
  [key: string]: unknown
}

export interface ShowCodeArgs {
  file_path: string
  start_line: number
  end_line?: number
  note?: string
}

export interface TeamMessageArgs {
  /** Name eines Teammitglieds oder "all" */
  to: string
  message: string
}

export interface AnswerPermissionArgs {
  request_id: number
  decision: 'allow' | 'deny'
  message?: string
}

export type ToolName =
  | 'show_code'
  | 'show_plan'
  | 'show_diff'
  | 'notify_user'
  | 'report_progress'
  | 'run_list'
  | 'run_output'
  | 'run_start'
  | 'run_stop'
  | 'team_members'
  | 'send_team_message'
  | 'answer_permission'

/** Tools, die jeder Claude-Agent in DevHub bekommt */
export const COMMON_TOOLS: ToolName[] = [
  'show_code',
  'show_plan',
  'show_diff',
  'notify_user',
  'report_progress',
  'run_list',
  'run_output',
  'run_start',
  'run_stop'
]

/** Entscheidung über eine Rechte-Abfrage eines Workers (null = keine, z. B. Agent beendet) */
export type PermissionDecision = { behavior: 'allow' } | { behavior: 'deny'; message: string }

export interface BridgeHandlers {
  onHook: (agentId: string, event: HookEvent) => void
  /** Welche Tools der Agent sieht (Team-Tools nur für Teammitglieder) */
  tools: (agentId: string) => ToolName[]
  /** Liefert den Antworttext an den Agent; Fehler werden als Tool-Fehler gemeldet */
  onToolCall: (agentId: string, name: ToolName, args: Record<string, unknown>) => Promise<string>
  /** Strg+G: Prompt-Datei im Editor-Tab bearbeiten; erfüllt, sobald der Tab geschlossen ist */
  onEditor: (agentId: string, filePath: string) => Promise<void>
  /** Editor-Anfrage abgebrochen (z. B. Agent beendet) */
  onEditorAbort: (agentId: string) => void
  /** PermissionRequest eines Workers; erfüllt, sobald der Orchestrator entschieden hat */
  onPermission: (
    agentId: string,
    event: HookEvent,
    signal: AbortSignal
  ) => Promise<PermissionDecision | null>
  /**
   * Stop-Hook (Agent meldet fertig): Antwort = Hook-Ausgabe für claude, z. B.
   * `{decision: "block", reason}` wenn Prüfungen fehlschlagen; null = Agent darf anhalten.
   */
  onStop: (agentId: string, event: HookEvent) => Promise<object | null>
}

const SHOW_PLAN_TOOL = {
  name: 'show_plan',
  description:
    'Show a plan, summary or other structured text to the user in the DevHub side panel (rendered ' +
    'as Markdown: headings, lists, check boxes "- [ ]"/"- [x]", code blocks, tables are shown as text). ' +
    'Use it for implementation plans, review results or step lists the user should keep in view; ' +
    'call it again with the same title to update it.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title of the tab' },
      markdown: { type: 'string', description: 'The content as Markdown' }
    },
    required: ['title', 'markdown']
  }
}

const SHOW_DIFF_TOOL = {
  name: 'show_diff',
  description:
    'Open the DevHub review window with the changes in your working directory (diff against the ' +
    'last commit), optionally focused on one file. Use it when you want the user to review your changes.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Optional: file to select in the review' }
    }
  }
}

const NOTIFY_USER_TOOL = {
  name: 'notify_user',
  description:
    'Send the user a short notification (DevHub inbox and, if the app is in the background, a ' +
    'desktop notification). Use it sparingly for things worth interrupting for: a long task is ' +
    'done, something needs a decision soon, or a problem you cannot solve.',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string', description: 'One or two sentences' } },
    required: ['message']
  }
}

const REPORT_PROGRESS_TOOL = {
  name: 'report_progress',
  description:
    'Report the progress of a longer task; shown next to your name in DevHub. ' +
    'Call it at meaningful steps (not for every tool call).',
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'What you are doing, e.g. "Step 3/5: migrating tests"'
      },
      percent: { type: 'number', minimum: 0, maximum: 100, description: 'Optional: 0-100' }
    },
    required: ['message']
  }
}

const RUN_NAME = {
  type: 'object',
  properties: { name: { type: 'string', description: 'Name of the command (see run_list)' } },
  required: ['name']
}

const RUN_LIST_TOOL = {
  name: 'run_list',
  description:
    'List the commands the user configured for this project in DevHub (dev server, tests, build …) ' +
    'with their state (running, last exit code).',
  inputSchema: { type: 'object', properties: {} }
}

const RUN_OUTPUT_TOOL = {
  name: 'run_output',
  description:
    'Read the latest output (stdout + stderr) of a project command managed by DevHub, e.g. the ' +
    'log of the running dev server or the result of the last test run.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name of the command (see run_list)' },
      lines: {
        type: 'integer',
        minimum: 1,
        description: 'How many lines from the end (default 80)'
      }
    },
    required: ['name']
  }
}

const RUN_START_TOOL = {
  name: 'run_start',
  description:
    'Start a project command managed by DevHub (no effect if it is already running). ' +
    'Read its output with run_output afterwards.',
  inputSchema: RUN_NAME
}

const RUN_STOP_TOOL = {
  name: 'run_stop',
  description: 'Stop a running project command managed by DevHub.',
  inputSchema: RUN_NAME
}

const SHOW_CODE_TOOL = {
  name: 'show_code',
  description:
    'Show a code location to the user in the DevHub code panel and highlight the given lines. ' +
    'Call this whenever you analyze code, investigate a problem or find a bug, so the user can see the relevant spot.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path, or path relative to the working directory'
      },
      start_line: { type: 'integer', minimum: 1, description: 'First line to highlight (1-based)' },
      end_line: { type: 'integer', minimum: 1, description: 'Last line to highlight (inclusive)' },
      note: { type: 'string', description: 'Short explanation shown above the code' }
    },
    required: ['file_path', 'start_line']
  }
}

const TEAM_MEMBERS_TOOL = {
  name: 'team_members',
  description:
    'List the other agents in your DevHub team (name, role, current status). ' +
    'Use it to find out whom to hand work to or ask.',
  inputSchema: { type: 'object', properties: {} }
}

const SEND_TEAM_MESSAGE_TOOL = {
  name: 'send_team_message',
  description:
    'Send a message to a teammate in your DevHub team. It is typed into their terminal as a new ' +
    'prompt (queued if they are busy). Use it to hand over work, ask a question or report a result. ' +
    'Be concise and self-contained (include file paths, what you did, what you need). ' +
    'Do not send pure acknowledgements or thanks, to avoid endless back-and-forth.',
  inputSchema: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Name of the teammate (see team_members), or "all" for every teammate'
      },
      message: { type: 'string', description: 'The message' }
    },
    required: ['to', 'message']
  }
}

const ANSWER_PERMISSION_TOOL = {
  name: 'answer_permission',
  description:
    'Answer a permission request from one of your workers (it arrives in your terminal as ' +
    '"[Permission request #<id> from <name>]"). The worker is blocked until you answer. ' +
    'Allow it, or deny it with a short reason / alternative the worker should follow instead.',
  inputSchema: {
    type: 'object',
    properties: {
      request_id: { type: 'integer', description: 'The number after "#" in the request' },
      decision: { type: 'string', enum: ['allow', 'deny'] },
      message: {
        type: 'string',
        description: 'For "deny": why, and what the worker should do instead'
      }
    },
    required: ['request_id', 'decision']
  }
}

const TOOLS: Record<ToolName, object> = {
  show_code: SHOW_CODE_TOOL,
  show_plan: SHOW_PLAN_TOOL,
  show_diff: SHOW_DIFF_TOOL,
  notify_user: NOTIFY_USER_TOOL,
  report_progress: REPORT_PROGRESS_TOOL,
  run_list: RUN_LIST_TOOL,
  run_output: RUN_OUTPUT_TOOL,
  run_start: RUN_START_TOOL,
  run_stop: RUN_STOP_TOOL,
  team_members: TEAM_MEMBERS_TOOL,
  send_team_message: SEND_TEAM_MESSAGE_TOOL,
  answer_permission: ANSWER_PERMISSION_TOOL
}

type JsonRpcMessage = {
  jsonrpc: '2.0'
  id?: string | number
  method?: string
  params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> }
}

export class AgentBridge {
  readonly token = randomBytes(16).toString('hex')
  private server: Server | null = null
  private port = 0

  constructor(private handlers: BridgeHandlers) {}

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handle(req, res))
    // Editor-Anfragen bleiben beliebig lange offen
    this.server.requestTimeout = 0
    this.server.timeout = 0
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    this.port = (this.server.address() as AddressInfo).port
  }

  stop(): void {
    this.server?.close()
  }

  hookUrl(agentId: string): string {
    return `http://127.0.0.1:${this.port}/hook/${this.token}/${agentId}`
  }

  permissionUrl(agentId: string): string {
    return `http://127.0.0.1:${this.port}/permission/${this.token}/${agentId}`
  }

  stopUrl(agentId: string): string {
    return `http://127.0.0.1:${this.port}/stop/${this.token}/${agentId}`
  }

  editorUrl(agentId: string): string {
    return `http://127.0.0.1:${this.port}/editor/${this.token}/${agentId}`
  }

  mcpUrl(agentId: string): string {
    return `http://127.0.0.1:${this.port}/mcp/${this.token}/${agentId}`
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const [, kind, token, agentId] = (req.url ?? '').split('?')[0].split('/')
    if (token !== this.token || !agentId) return end(res, 404)

    if (kind === 'hook' && req.method === 'POST') {
      try {
        this.handlers.onHook(agentId, JSON.parse((await readBody(req)) || '{}'))
      } catch (e) {
        console.error('[DevHub] Hook-Ereignis ungültig:', e)
      }
      return end(res, 204)
    }

    // Stop-Hook: offen halten, bis die Prüfungen des Projekts gelaufen sind. Leere Antwort =
    // Agent hält an; `{decision: "block", reason}` = er arbeitet mit dieser Begründung weiter.
    if (kind === 'stop' && req.method === 'POST') {
      let output: object | null = null
      try {
        output = await this.handlers.onStop(agentId, JSON.parse((await readBody(req)) || '{}'))
      } catch (e) {
        console.error('[DevHub] Stop-Hook:', e)
      }
      if (!output || res.writableEnded) return end(res, 200)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(output))
      return
    }

    // Rechte-Abfrage eines Workers: offen halten, bis der Orchestrator entschieden hat.
    // Antwort = Hook-Ausgabe für claude; leere Antwort → claude zeigt seinen normalen Dialog.
    if (kind === 'permission' && req.method === 'POST') {
      const abort = new AbortController()
      res.on('close', () => {
        if (!res.writableEnded) abort.abort()
      })
      let decision: PermissionDecision | null = null
      try {
        const event = JSON.parse((await readBody(req)) || '{}')
        decision = await this.handlers.onPermission(agentId, event, abort.signal)
      } catch (e) {
        console.error('[DevHub] Rechte-Abfrage:', e)
      }
      if (!decision || res.writableEnded) return end(res, 200)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: 'PermissionRequest', decision }
        })
      )
      return
    }

    // Strg+G im Agent: claude startet $EDITOR = curl mit dem Pfad der Prompt-Datei als Body.
    // Die Anfrage bleibt offen, bis der Editor-Tab geschlossen wird – so lange wartet claude.
    if (kind === 'editor' && req.method === 'POST') {
      const filePath = (await readBody(req)).trim()
      // Verbindung bricht ab (Agent beendet, curl abgebrochen) → Editor-Tab schließen
      res.on('close', () => {
        if (!res.writableEnded) this.handlers.onEditorAbort(agentId)
      })
      try {
        await this.handlers.onEditor(agentId, filePath)
      } catch (e) {
        console.error('[DevHub] Editor-Anfrage:', e)
      }
      return end(res, 200)
    }

    if (kind === 'mcp') {
      if (req.method === 'DELETE') return end(res, 200)
      if (req.method !== 'POST') return end(res, 405)
      try {
        const body = JSON.parse(await readBody(req))
        const messages: JsonRpcMessage[] = Array.isArray(body) ? body : [body]
        const responses = (
          await Promise.all(messages.map((m) => this.handleMcp(agentId, m)))
        ).filter(Boolean)
        if (responses.length === 0) return end(res, 202)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(Array.isArray(body) ? responses : responses[0]))
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' }
          })
        )
      }
      return
    }

    end(res, 404)
  }

  private async handleMcp(agentId: string, msg: JsonRpcMessage): Promise<object | null> {
    if (process.env.DEVHUB_DEBUG) console.log('[DevHub] MCP', agentId.slice(0, 8), msg.method)
    if (msg.id === undefined) return null // Notification
    const ok = (result: object): object => ({ jsonrpc: '2.0', id: msg.id, result })

    switch (msg.method) {
      case 'initialize':
        return ok({
          protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'devhub', version: '1.0.0' }
        })
      case 'ping':
        return ok({})
      case 'tools/list':
        return ok({ tools: this.handlers.tools(agentId).map((t) => TOOLS[t]) })
      case 'tools/call': {
        const name = msg.params?.name as ToolName
        if (!this.handlers.tools(agentId).includes(name)) {
          return ok({ isError: true, content: [{ type: 'text', text: 'Unknown tool' }] })
        }
        try {
          const text = await this.handlers.onToolCall(agentId, name, msg.params?.arguments ?? {})
          return ok({ content: [{ type: 'text', text }] })
        } catch (e) {
          return ok({ isError: true, content: [{ type: 'text', text: String(e) }] })
        }
      }
      default:
        return {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: `Method not found: ${msg.method}` }
        }
    }
  }
}

function end(res: ServerResponse, status: number): void {
  res.writeHead(status)
  res.end()
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 5_000_000) req.destroy()
      else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
