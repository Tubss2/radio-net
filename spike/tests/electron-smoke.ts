/**
 * Drives the real Electron client (built: ../client/out) on a virtual X display with a fake mic.
 * A bot (rtc-node) plays "Sgt Miller" on the same channels. Proves on Linux/Xvfb:
 *   onboarding by invite code, tune by freq + by name, hearing a remote speaker (speaker UI),
 *   global PTT via the uiohook mouse hook (xdotool presses Mouse 4), audio actually reaching the bot,
 *   cycle key (Mouse 5), overlay window state. Screenshots -> ../shots/.
 * Needs: Xvfb on :99 with RECORD, LiveKit dev server, token server (dev seed, invite DEVN-ET01).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackKind, TrackPublishOptions, TrackSource, dispose } from '@livekit/rtc-node';
import { _electron as electron } from 'playwright-core';

const API = 'http://127.0.0.1:8787';
const SHOTS = new URL('../shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = '') => { results.push([n, ok, d]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  (${d})` : ''}`); };
const xdo = (...a: string[]) => execFileSync('xdotool', a, { env: { ...process.env, DISPLAY: ':99' } });

async function post(path: string, body: unknown, token?: string) {
  const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return r.json();
}

async function main() {
  // Bot joins the dev community.
  const bot = await post('/api/join', { inviteCode: 'DEVN-ET01', displayName: 'Sgt Miller' });
  const chans = (await (await fetch(`${API}/api/communities/dev/channels`, { headers: { authorization: `Bearer ${bot.token}` } })).json()).channels;
  const id = (n: string) => chans.find((c: any) => c.name === n).id;
  const { livekitUrl, grants } = await post('/api/communities/dev/radio/tokens', { channelIds: [id('Command'), id('Arty')] }, bot.token);
  const botRooms: Record<string, { room: Room; src: AudioSource }> = {};
  const heard: Record<string, number> = {};
  for (const g of grants) {
    const room = new Room();
    room.on(RoomEvent.TrackSubscribed, async (t, _p, participant) => {
      if (t.kind !== TrackKind.KIND_AUDIO) return;
      for await (const f of new AudioStream(t, 48000, 1)) {
        let s = 0; for (let i = 0; i < f.data.length; i++) s += f.data[i] ** 2;
        if (Math.sqrt(s / f.data.length) > 300) heard[`${g.name}:${participant.name}`] = (heard[`${g.name}:${participant.name}`] ?? 0) + 1;
      }
    });
    await room.connect(livekitUrl, g.token);
    const src = new AudioSource(48000, 1);
    const o = new TrackPublishOptions(); o.source = TrackSource.SOURCE_MICROPHONE;
    await room.localParticipant!.publishTrack(LocalAudioTrack.createAudioTrack('mic', src), o);
    botRooms[g.name] = { room, src };
  }

  const app = await electron.launch({
    executablePath: new URL('../client/node_modules/electron/dist/electron', import.meta.url).pathname,
    args: ['../client/out/main/index.js', '--no-sandbox'],
    env: { ...process.env, DISPLAY: ':99', RN_FAKE_MEDIA: '1', RN_USER_DATA: `/tmp/rn-smoke-${Date.now()}`, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });
  await sleep(2500);
  app.windows().forEach((w) => w.on('console', (m) => { if (m.type() === 'error') console.log('   [renderer]', m.text().slice(0, 160)); }));
  const wins = app.windows();
  const page = wins.find((w) => w.url().includes('index.html'))!;
  const ov = wins.find((w) => w.url().includes('overlay.html'));
  await page.setViewportSize({ width: 1180, height: 760 }).catch(() => undefined);

  // Onboarding
  await page.screenshot({ path: SHOTS + '1-onboarding.png' });
  await page.fill('input.code', 'devn et01');
  await page.fill('input[placeholder="Toby"]', 'Toby');
  await page.click('button.btn.primary');
  await sleep(1500);
  await page.screenshot({ path: SHOTS + '1b-after-join.png' });
  console.log('   err text:', await page.locator('.err').textContent().catch(() => 'none'));
  await page.waitForSelector('.tunebox input', { timeout: 10000 });
  check('joined community by invite code', true);

  // Tune by frequency and by name
  await page.fill('.tunebox input', '59.5'); await page.press('.tunebox input', 'Enter');
  await page.waitForSelector('.card >> text=Command', { timeout: 15000 });
  await page.fill('.tunebox input', 'arty'); await page.press('.tunebox input', 'Enter');
  await page.waitForSelector('.card >> text=Arty', { timeout: 15000 });
  check('tuned 2 channels (by freq "59.5" and by name "arty")', (await page.locator('.card').count()) === 2);

  // Bot talks on Command -> app shows speaker
  const tone = async (src: AudioSource, ms: number) => {
    let ph = 0; const t0 = Date.now();
    while (Date.now() - t0 < ms) { const f = AudioFrame.create(48000, 1, 480); for (let i = 0; i < 480; i++) f.data[i] = Math.round(9000 * Math.sin((ph++ * 2 * Math.PI * 330) / 48000)); await src.captureFrame(f); }
  };
  const talking = tone(botRooms.Command.src, 3000);
  const seen = await page.waitForSelector('.card .talking >> text=Sgt Miller', { timeout: 4000 }).then(() => true).catch(() => false);
  await page.screenshot({ path: SHOTS + '2-hearing-command.png' });
  await talking;
  check('app shows remote speaker on the right channel card', seen);

  // Transmit: TX defaults to first tuned TX channel (Command). Hold Mouse 4 via the global hook.
  const before = { ...heard };
  xdo('mousemove', '600', '400');
  xdo('mousedown', '8');
  await sleep(1200);
  const keyedUi = await page.locator('.txbar.keyed').count();
  await page.screenshot({ path: SHOTS + '3-transmitting.png' });
  if (ov) await ov.screenshot({ path: SHOTS + '4-overlay.png' }).catch(() => undefined);
  await sleep(800);
  xdo('mouseup', '8');
  await sleep(800);
  const gotCmd = (heard['Command:Toby'] ?? 0) - (before['Command:Toby'] ?? 0);
  const gotArty = (heard['Arty:Toby'] ?? 0) - (before['Arty:Toby'] ?? 0);
  check('global PTT (Mouse 4 via uiohook) keys up the UI', keyedUi === 1);
  check('Toby audio reached bot on Command only', gotCmd > 10 && gotArty === 0, `Command frames=${gotCmd}, Arty frames=${gotArty}`);
  check('PTT release un-keys', (await page.locator('.txbar.keyed').count()) === 0);

  // Cycle (Mouse 5) -> TX moves to Arty, then talk again
  const txBefore = await page.textContent('.txbar .nm');
  xdo('click', '9');
  await sleep(400);
  const txAfter = await page.textContent('.txbar .nm');
  check('cycle key (Mouse 5) moves TX', txBefore !== txAfter, `${txBefore} -> ${txAfter}`);
  const b2 = { ...heard };
  xdo('mousedown', '8'); await sleep(1800); xdo('mouseup', '8'); await sleep(800);
  const a2 = (heard['Arty:Toby'] ?? 0) - (b2['Arty:Toby'] ?? 0);
  const c2 = (heard['Command:Toby'] ?? 0) - (b2['Command:Toby'] ?? 0);
  check('after cycle, audio goes to Arty only', a2 > 10 && c2 === 0, `Arty=${a2}, Command=${c2}`);
  await page.screenshot({ path: SHOTS + '5-tx-arty.png' });

  const proc = app.process();
  await Promise.race([app.close(), sleep(5000)]);
  if (proc.exitCode === null) { console.log('   (app.close() hung, killing; see notes)'); proc.kill('SIGKILL'); }
  for (const r of Object.values(botRooms)) await r.room.disconnect();
  await dispose();
  const failed = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
