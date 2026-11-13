import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import { timingSafeEqual } from 'crypto'
import { networkInterfaces } from 'os'
import type { PermissionAnswer, RemoteInfo, Settings } from '../shared/types'
import { isTeamWorker } from '../shared/types'
import type { AgentManager } from './agents'
import { getState } from './store'

/**
 * Remote access for the phone (can be turned off, off by default): small HTTP server in the
 * local network. Shows the agents with status and last reply, accepts instructions and decides
 * permission requests. Access only with the secret token in the path; unencrypted (HTTP) –
 * therefore meant only for trusted networks or via a VPN.
 */
export class RemoteServer {
  private server: Server | null = null
  private port = 0
  private token = ''
  private error: string | undefined

  constructor(private agents: AgentManager) {}

  /** Starts, stops or restarts – depending on the settings */
  apply(settings: Settings): void {
    const wanted = settings.remoteEnabled && !!settings.remoteToken
    const same =
      this.server && this.port === settings.remotePort && this.token === settings.remoteToken
    if (wanted && same) return
    this.server?.close()
    this.server = null
    this.error = undefined
    if (!wanted) return
    this.port = settings.remotePort
    this.token = settings.remoteToken
    const server = createServer((req, res) => {
      this.handle(req, res).catch(() => send(res, 500, 'text/plain', 'Fehler'))
    })
    server.on('error', (e: NodeJS.ErrnoException) => {
      this.error =
        e.code === 'EADDRINUSE' ? `Port ${this.port} ist bereits belegt` : String(e.message)
      if (this.server === server) this.server = null
    })
    server.listen(this.port, '0.0.0.0')
    this.server = server
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  info(): RemoteInfo {
    if (!this.server) return { running: false, urls: [], error: this.error }
    const urls: string[] = []
    for (const list of Object.values(networkInterfaces())) {
      for (const net of list ?? []) {
        if (net.family === 'IPv4' && !net.internal)
          urls.push(`http://${net.address}:${this.port}/${this.token}/`)
      }
    }
    return { running: true, urls, error: this.error }
  }

  private authorized(token: string): boolean {
    const a = Buffer.from(token)
    const b = Buffer.from(this.token)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const [, token, ...rest] = (req.url ?? '').split('?')[0].split('/')
    if (!token || !this.authorized(token)) return send(res, 404, 'text/plain', 'Not found')
    const path = rest.join('/')

    if (req.method === 'GET' && path === '') return send(res, 200, 'text/html; charset=utf-8', PAGE)
    if (req.method === 'GET' && path === 'api/state') return json(res, this.state())

    if (req.method === 'POST' && path === 'api/send') {
      const body = await readJson(req)
      const text = String(body.text ?? '').trim()
      if (!text) return json(res, { error: 'Text fehlt' }, 400)
      try {
        await this.agents.sendLine(String(body.agentId ?? ''), text)
        return json(res, { ok: true })
      } catch (e) {
        return json(res, { error: e instanceof Error ? e.message : String(e) }, 400)
      }
    }

    if (req.method === 'POST' && path === 'api/permission') {
      const body = await readJson(req)
      const answer = String(body.answer ?? '') as PermissionAnswer
      if (!['allow', 'deny', 'always'].includes(answer))
        return json(res, { error: 'Ungültige Antwort' }, 400)
      try {
        this.agents.answerUserPermission(Number(body.id), answer, String(body.message ?? ''))
        return json(res, { ok: true })
      } catch (e) {
        return json(res, { error: e instanceof Error ? e.message : String(e) }, 400)
      }
    }
    send(res, 404, 'text/plain', 'Not found')
  }

  private state(): object {
    const projects = getState().projects
    const list = this.agents.list()
    return {
      agents: list.map((a) => ({
        id: a.id,
        name: a.name,
        project: projects.find((p) => p.id === a.projectId)?.name ?? '',
        status: a.status,
        statusMessage: a.statusMessage ?? '',
        activity: a.progress?.message ?? a.activity ?? '',
        lastMessage: (a.lastMessage ?? '').slice(0, 700),
        readOnly: isTeamWorker(a)
      })),
      permissions: this.agents.userPermissions().map((p) => ({
        ...p,
        agent: list.find((a) => a.id === p.agentId)?.name ?? '?'
      }))
    }
  }
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  if (res.writableEnded) return
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

const json = (res: ServerResponse, data: object, status = 200): void =>
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(data))

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 100_000) req.destroy()
      else chunks.push(c)
    })
    req.on('end', () => {
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(data && typeof data === 'object' ? data : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

/** Page for the phone: polls the state every 3 s; content is only inserted as text. */
const PAGE = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DevHub</title>
<style>
  body { margin: 0; font: 15px/1.4 system-ui, sans-serif; background: #1b1d23; color: #e6e6e6; }
  header { padding: 12px 14px; font-weight: 600; background: #23262e; position: sticky; top: 0; }
  main { padding: 10px; display: grid; gap: 10px; }
  .card { background: #23262e; border: 1px solid #343843; border-radius: 8px; padding: 10px 12px; }
  .card.wait { border-color: #e0b341; }
  .name { font-weight: 600; }
  .muted { color: #9aa0ac; font-size: 13px; }
  .msg { white-space: pre-wrap; font-size: 13px; margin: 8px 0; max-height: 9em; overflow: auto; }
  .row { display: flex; gap: 6px; margin-top: 8px; }
  input { flex: 1; min-width: 0; padding: 9px; border-radius: 6px; border: 1px solid #343843;
          background: #1b1d23; color: inherit; font: inherit; }
  button { padding: 9px 12px; border-radius: 6px; border: 1px solid #343843; background: #2d313b;
           color: inherit; font: inherit; }
  button.ok { background: #2f6f4f; } button.no { background: #7a3535; }
  code { display: block; white-space: pre-wrap; word-break: break-all; font-size: 12px;
         background: #1b1d23; padding: 6px; border-radius: 6px; margin-top: 6px; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px;
         background: #6b7280; }
  .dot.working { background: #4c9be8; } .dot.needsInput { background: #e0b341; }
  .dot.idle { background: #5fb878; }
</style>
</head>
<body>
<header>DevHub <span class="muted" id="info"></span></header>
<main id="list"></main>
<script>
var drafts = {};
function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function post(path, body) {
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body) }).then(function (r) { return r.json(); })
    .then(function (d) { if (d.error) alert(d.error); load(); });
}
function render(state) {
  var list = document.getElementById('list');
  var focused = document.activeElement && document.activeElement.dataset
    ? document.activeElement.dataset.agent : null;
  list.textContent = '';
  state.permissions.forEach(function (p) {
    var c = el('div', 'card wait');
    c.appendChild(el('div', 'name', 'Freigabe: ' + p.agent + ' → ' + p.tool));
    c.appendChild(el('code', '', p.summary));
    var row = el('div', 'row');
    var yes = el('button', 'ok', 'Erlauben');
    yes.onclick = function () { post('api/permission', { id: p.id, answer: 'allow' }); };
    var no = el('button', 'no', 'Ablehnen');
    no.onclick = function () { post('api/permission', { id: p.id, answer: 'deny' }); };
    row.appendChild(yes); row.appendChild(no);
    if (p.rule) {
      var always = el('button', '', 'Immer (' + p.rule + ')');
      always.onclick = function () { post('api/permission', { id: p.id, answer: 'always' }); };
      row.appendChild(always);
    }
    c.appendChild(row);
    list.appendChild(c);
  });
  state.agents.forEach(function (a) {
    var c = el('div', 'card' + (a.status === 'needsInput' ? ' wait' : ''));
    var head = el('div', 'name');
    head.appendChild(el('span', 'dot ' + a.status));
    head.appendChild(document.createTextNode(a.name + ' '));
    head.appendChild(el('span', 'muted', a.project));
    c.appendChild(head);
    c.appendChild(el('div', 'muted', a.status === 'needsInput' ? a.statusMessage : a.activity));
    if (a.lastMessage) c.appendChild(el('div', 'msg', a.lastMessage));
    if (!a.readOnly) {
      var row = el('div', 'row');
      var input = el('input');
      input.placeholder = 'Anweisung an ' + a.name;
      input.dataset.agent = a.id;
      input.value = drafts[a.id] || '';
      input.oninput = function () { drafts[a.id] = input.value; };
      var go = el('button', '', 'Senden');
      var sendNow = function () {
        if (!input.value.trim()) return;
        var text = input.value; drafts[a.id] = ''; input.value = '';
        post('api/send', { agentId: a.id, text: text });
      };
      go.onclick = sendNow;
      input.onkeydown = function (e) { if (e.key === 'Enter') sendNow(); };
      row.appendChild(input); row.appendChild(go);
      c.appendChild(row);
    }
    list.appendChild(c);
  });
  if (!state.agents.length) list.appendChild(el('div', 'muted', 'Keine Agents laufen.'));
  if (focused) {
    var again = document.querySelector('input[data-agent="' + focused + '"]');
    if (again) again.focus();
  }
  var waiting = state.agents.filter(function (a) { return a.status === 'needsInput'; }).length;
  document.getElementById('info').textContent =
    state.agents.length + ' Agents' + (waiting ? ' · ' + waiting + ' warten' : '');
}
function load() {
  // Do not rebuild while typing (the on-screen keyboard would not stay open otherwise)
  fetch('api/state').then(function (r) { return r.json(); }).then(render).catch(function () {
    document.getElementById('info').textContent = 'keine Verbindung';
  });
}
load();
setInterval(function () {
  var a = document.activeElement;
  if (!(a && a.tagName === 'INPUT' && a.value)) load();
}, 3000);
</script>
</body>
</html>`
