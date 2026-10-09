import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createHelperServer } from './server.js';

const servers: Array<ReturnType<typeof createHelperServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

function request(port: number, method: string, headers: Record<string, string>, path = '/health'): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('helper HTTP server', () => {
  it('binds loopback, answers Private Network Access for Pages, and never keys the mic over HTTP', async () => {
    const helper = createHelperServer();
    servers.push(helper);
    const port = await helper.listen(0);
    const addr = helper.http.address();
    expect(typeof addr === 'object' && addr ? addr.address : '').toBe('127.0.0.1');

    const evil = await request(port, 'OPTIONS', { origin: 'https://evil.example', host: `127.0.0.1:${port}` });
    expect(evil.status).toBe(403);
    expect(evil.headers['access-control-allow-private-network']).toBeUndefined();

    const pages = await request(port, 'OPTIONS', { origin: 'https://tubss2.github.io', host: `127.0.0.1:${port}` });
    expect(pages.status).toBe(204);
    expect(pages.headers['access-control-allow-origin']).toBe('https://tubss2.github.io');
    expect(pages.headers['access-control-allow-private-network']).toBe('true');
    expect(pages.headers['access-control-allow-origin']).not.toBe('*');

    const rebound = await request(port, 'OPTIONS', { origin: 'https://tubss2.github.io', host: 'evil.example' });
    expect(rebound.status).toBe(421);

    const health = await request(port, 'GET', { origin: 'https://tubss2.github.io', host: `127.0.0.1:${port}` }, '/health?talk=down');
    expect(health.status).toBe(200);
    expect(health.body).not.toContain(helper.gate.secret);
    expect(helper.talkDown()).toBe(false);

    const post = await request(port, 'POST', { origin: 'https://tubss2.github.io', host: `127.0.0.1:${port}` }, '/talk?down=1');
    expect(post.status).toBe(405);
    expect(helper.talkDown()).toBe(false);
  });

  it('ignores the socket until the pairing secret, then refuses a second use', async () => {
    const helper = createHelperServer();
    servers.push(helper);
    const port = await helper.listen(0);
    const url = `ws://127.0.0.1:${port}/`;

    const evil = new WebSocket(url, { headers: { Origin: 'https://evil.example' } });
    const evilClosed = new Promise<void>((resolve) => evil.on('error', () => resolve()).on('close', () => resolve()));
    await evilClosed;
    expect(helper.talkDown()).toBe(false);

    const page = new WebSocket(url, { headers: { Origin: 'https://tubss2.github.io' } });
    await new Promise<void>((resolve) => page.on('open', () => resolve()));
    page.send(JSON.stringify({ type: 'talk', down: true, key: 65 }));
    await new Promise((r) => setTimeout(r, 30));
    expect(helper.talkDown()).toBe(false);

    const authed = new Promise<string>((resolve) => page.once('message', (d) => resolve(String(d))));
    page.send(JSON.stringify({ type: 'auth', secret: helper.gate.secret }));
    expect(JSON.parse(await authed)).toEqual({ type: 'authed' });

    const talked = new Promise<string>((resolve) => page.once('message', (d) => resolve(String(d))));
    helper.emitTalk(true);
    expect(JSON.parse(await talked)).toEqual({ type: 'talk', down: true });
    page.send(JSON.stringify({ type: 'talk', down: false, keycode: 1 }));
    await new Promise((r) => setTimeout(r, 20));
    expect(helper.talkDown()).toBe(true);

    const again = new WebSocket(url, { headers: { Origin: 'https://tubss2.github.io' } });
    await new Promise<void>((resolve) => again.on('open', () => resolve()));
    again.send(JSON.stringify({ type: 'auth', secret: helper.gate.secret }));
    await new Promise((r) => setTimeout(r, 30));
    helper.emitTalk(false);
    const heard: string[] = [];
    again.on('message', (d) => heard.push(String(d)));
    await new Promise((r) => setTimeout(r, 30));
    expect(heard).toEqual([]);
    page.close();
    again.close();
  });
});
