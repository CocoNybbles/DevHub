import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import type { AddressInfo } from 'net'

/**
 * Lokaler HTTP-Server (nur 127.0.0.1) als Rückkanal von den Agents zur App:
 *  - POST /hook/<token>/<agentId>  → Claude-Code-Hooks (per curl, Hook-JSON im Body)
 *  - POST /mcp/<token>/<agentId>   → minimaler MCP-Server (Streamable HTTP, JSON-Antworten)
 *                                    mit `show_code` und – nur für Teammitglieder –
 *                                    `team_members` / `send_team_message`
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

export type ToolName = 'show_code' | 'team_members' | 'send_team_message'

export interface BridgeHandlers {
  onHook: (agentId: string, event: HookEvent) => void
  /** Welche Tools der Agent sieht (Team-Tools nur für Teammitglieder) */
  tools: (agentId: string) => ToolName[]
  /** Liefert den Antworttext an den Agent; Fehler werden als Tool-Fehler gemeldet */
  onToolCall: (agentId: string, name: ToolName, args: Record<string, unknown>) => Promise<string>
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

const TOOLS: Record<ToolName, object> = {
  show_code: SHOW_CODE_TOOL,
  team_members: TEAM_MEMBERS_TOOL,
  send_team_message: SEND_TEAM_MESSAGE_TOOL
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
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    this.port = (this.server.address() as AddressInfo).port
  }

  stop(): void {
    this.server?.close()
  }

  hookUrl(agentId: string): string {
    return `http://127.0.0.1:${this.port}/hook/${this.token}/${agentId}`
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
