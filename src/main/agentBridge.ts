import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import type { AddressInfo } from 'net'

/**
 * Lokaler HTTP-Server (nur 127.0.0.1) als Rückkanal von den Agents zur App:
 *  - POST /hook/<token>/<agentId>  → Claude-Code-Hooks (per curl, Hook-JSON im Body)
 *  - POST /mcp/<token>/<agentId>   → minimaler MCP-Server (Streamable HTTP, JSON-Antworten)
 *                                    mit dem Tool `show_code`
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

export interface BridgeHandlers {
  onHook: (agentId: string, event: HookEvent) => void
  onShowCode: (agentId: string, args: ShowCodeArgs) => string | Promise<string>
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

type JsonRpcMessage = {
  jsonrpc: '2.0'
  id?: string | number
  method?: string
  params?: { protocolVersion?: string; name?: string; arguments?: ShowCodeArgs }
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
        return ok({ tools: [SHOW_CODE_TOOL] })
      case 'tools/call': {
        if (msg.params?.name !== 'show_code') {
          return ok({ isError: true, content: [{ type: 'text', text: 'Unknown tool' }] })
        }
        try {
          const text = await this.handlers.onShowCode(
            agentId,
            msg.params.arguments ?? ({} as ShowCodeArgs)
          )
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
