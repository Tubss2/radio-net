import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  HELPER_BIND_HOST, HELPER_PORT, HelperGate, isLoopbackHost, privateNetworkHeaders, talkMessage, upgradeAllowed,
} from './gate.js';

interface AuthedSocket {
  authed: boolean;
  send: (data: string) => void;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function write(res: ServerResponse, status: number, headers: Record<string, string>, body = ''): void {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

/**
 * HTTP exists for the Private Network Access preflight and a status page.
 * Neither path, nor any query string, changes talk state. The mic follows Raw Input,
 * which calls emitTalk. Inbound WebSocket messages can only present the pairing secret.
 */
export function createHelperServer(gate = new HelperGate()) {
  let talkDown = false;
  const sockets = new Set<AuthedSocket>();

  const http: Server = createServer((req, res) => {
    if (!isLoopbackHost(header(req, 'host'))) {
      write(res, 421, {});
      return;
    }
    const origin = header(req, 'origin');
    if (req.method === 'OPTIONS') {
      const allow = privateNetworkHeaders(origin);
      if (!allow) {
        write(res, 403, {});
        return;
      }
      write(res, 204, allow);
      return;
    }
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && path === '/health') {
      const allow = privateNetworkHeaders(origin) ?? {};
      write(res, 200, { 'Content-Type': 'application/json', ...allow }, JSON.stringify({ service: 'radionet-ptt' }));
      return;
    }
    write(res, 405, { Allow: 'GET, OPTIONS' });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  http.on('upgrade', (req, socket, head) => {
    if (!upgradeAllowed(header(req, 'origin'), header(req, 'host'))) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => accept(ws));
  });

  function accept(ws: WebSocket): void {
    const slot: AuthedSocket = { authed: false, send: (data) => ws.send(data) };
    sockets.add(slot);
    ws.on('message', (data) => {
      if (slot.authed) return;
      let secret = '';
      try {
        const msg = JSON.parse(String(data)) as { type?: unknown; secret?: unknown };
        if (msg?.type === 'auth' && typeof msg.secret === 'string') secret = msg.secret;
      } catch {
        secret = '';
      }
      if (!gate.authorize(secret)) return;
      slot.authed = true;
      ws.send(JSON.stringify({ type: 'authed' }));
    });
    ws.on('close', () => sockets.delete(slot));
  }

  function emitTalk(down: boolean): void {
    talkDown = Boolean(down);
    const msg = talkMessage(talkDown);
    for (const slot of sockets) if (slot.authed) slot.send(msg);
  }

  async function listen(port = HELPER_PORT): Promise<number> {
    await new Promise<void>((resolve) => http.listen(port, HELPER_BIND_HOST, () => resolve()));
    const addr = http.address();
    return typeof addr === 'object' && addr ? addr.port : port;
  }

  return {
    http,
    gate,
    listen,
    emitTalk,
    talkDown: () => talkDown,
    close: () => new Promise<void>((resolve) => {
      wss.close();
      http.close(() => resolve());
    }),
  };
}
