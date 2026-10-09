/**
 * Headless end-to-end check of the Radio Net model against a local LiveKit dev server + token server.
 * Bots stand in for players. Proves: multi-room tune, listen-many/talk-one, TX cycling,
 * server-enforced publish permissions, and channel deletion kicking listeners.
 *
 *   ../livekit/run-dev.sh &  (cd ../server && npm start) &  npx tsx radio-e2e.ts
 */
import {
  AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent,
  TrackKind, TrackPublishOptions, TrackSource, dispose,
} from '@livekit/rtc-node';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

const API = process.env.API_URL ?? 'http://127.0.0.1:8787';
// Remote runs (deployed server): SETUP_CODE for community creation, LiveKit URLs + keys for the listen-only check.
const SETUP_CODE = process.env.SETUP_CODE;
const LK_WS = process.env.LIVEKIT_WS ?? 'ws://127.0.0.1:7880';
const LK_HTTP = process.env.LIVEKIT_HTTP ?? 'http://127.0.0.1:7880';
const LK_KEY = process.env.LIVEKIT_API_KEY ?? 'devkey';
const LK_SECRET = process.env.LIVEKIT_API_SECRET ?? 'secret';
let CID = '';
const tokens = new Map<string, string>(); // bot name -> device token
const RATE = 48000;
const FRAME = 480; // 10 ms

type Grant = { channelId: string; room: string; name: string; freqKHz: number; canTransmit: boolean; token: string };

async function api(path: string, user: string | null, init: RequestInit = {}) {
  const tok = user ? tokens.get(user) : undefined;
  const res = await fetch(API + path, {
    ...init,
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
  });
  if (!res.ok && res.status !== 204) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/** Minimal version of the client's RadioEngine: one Room per tuned channel, one TX channel. */
class BotRadio {
  rooms = new Map<string, { room: Room; source?: AudioSource; grant: Grant }>();
  tx: string | null = null;
  /** energetic frames received, per channel name */
  heard = new Map<string, number>();
  firstHeardAt = new Map<string, number>();
  disconnected: string[] = [];
  private keyed = false;

  constructor(public user: string) {}

  async tune(names: string[]) {
    const { channels } = await api(`/api/communities/${CID}/channels`, this.user);
    const ids = names.map((n) => channels.find((c: any) => c.name === n).id);
    const { livekitUrl, grants } = await api(`/api/communities/${CID}/radio/tokens`, this.user, {
      method: 'POST', body: JSON.stringify({ channelIds: ids }),
    });
    await Promise.all(
      (grants as Grant[]).map(async (g) => {
        const room = new Room();
        room.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind !== TrackKind.KIND_AUDIO) return;
          void this.meter(g.name, new AudioStream(track, RATE, 1));
        });
        room.on(RoomEvent.Disconnected, () => this.disconnected.push(g.name));
        await room.connect(livekitUrl, g.token, { autoSubscribe: true, dynacast: false });
        const entry: { room: Room; source?: AudioSource; grant: Grant } = { room, grant: g };
        if (g.canTransmit) {
          // Pre-publish a mic track in every TX-capable channel so switching TX is instant.
          entry.source = new AudioSource(RATE, 1);
          const track = LocalAudioTrack.createAudioTrack('mic', entry.source);
          const opts = new TrackPublishOptions();
          opts.source = TrackSource.SOURCE_MICROPHONE;
          await room.localParticipant!.publishTrack(track, opts);
        }
        this.rooms.set(g.name, entry);
      }),
    );
  }

  setTx(name: string) { this.tx = name; }

  cycleTx() {
    const tx = [...this.rooms.values()].filter((r) => r.grant.canTransmit).map((r) => r.grant.name).sort();
    this.tx = tx[(tx.indexOf(this.tx ?? '') + 1) % tx.length];
    return this.tx;
  }

  /** Hold PTT for ms: sine tone into the active channel only. */
  async ptt(ms: number) {
    const src = this.rooms.get(this.tx!)!.source!;
    this.keyed = true;
    const t0 = Date.now();
    let phase = 0;
    while (Date.now() - t0 < ms) {
      const f = AudioFrame.create(RATE, 1, FRAME);
      for (let i = 0; i < FRAME; i++) f.data[i] = Math.round(8000 * Math.sin((phase++ * 2 * Math.PI * 440) / RATE));
      await src.captureFrame(f);
    }
    await src.waitForPlayout(); // release PTT = stop sending; don't leave buffered audio behind
    this.keyed = false;
    return t0;
  }

  private async meter(name: string, stream: AudioStream) {
    for await (const frame of stream) {
      let sum = 0;
      for (let i = 0; i < frame.data.length; i++) sum += frame.data[i] * frame.data[i];
      if (Math.sqrt(sum / frame.data.length) > 500) {
        this.heard.set(name, (this.heard.get(name) ?? 0) + 1);
        if (!this.firstHeardAt.has(name)) this.firstHeardAt.set(name, Date.now());
      }
    }
  }

  reset() { this.heard.clear(); this.firstHeardAt.clear(); }
  async close() { await Promise.all([...this.rooms.values()].map((r) => r.room.disconnect().catch(() => {}))); }
}

const results: { check: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ check: name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const heard = (b: BotRadio) => Object.fromEntries(b.heard);

async function main() {
  // Toby creates a community in-app (no Discord); the bots join with the invite code + a display name.
  const c = await api('/api/communities', null, { method: 'POST', body: JSON.stringify({ name: 'E2E Unit', displayName: 'toby', ...(SETUP_CODE ? { setupCode: SETUP_CODE } : {}) }) });
  tokens.set('toby', c.token);
  CID = c.community.id;
  for (const bot of ['alice', 'bob', 'carol', 'dave', 'eve']) {
    const j = await api('/api/join', null, { method: 'POST', body: JSON.stringify({ inviteCode: c.community.inviteCode, displayName: bot }) });
    tokens.set(bot, j.token);
  }
  check('community created in-app, 5 members joined by invite code', tokens.size === 6, c.community.inviteCode);
  await api(`/api/communities/${CID}/channels`, 'toby', { method: 'POST', body: JSON.stringify({ freq: '59.5', name: 'Command' }) });
  // Admin creates an ad-hoc fireteam channel.
  const ft = `FT ${Date.now() % 10000}`;
  let freq = '59.5';
  while (freq === '59.5') {
    const whole = 30 + Math.floor(Math.random() * 58); // 30.0–87.5, half-megahertz steps
    freq = `${whole}.${Math.random() < 0.5 ? '0' : '5'}`;
  }
  const created = await api(`/api/communities/${CID}/channels`, 'toby', { method: 'POST', body: JSON.stringify({ freq, name: ft }) });
  console.log(`created ${created.channel.freq} MHz "${ft}"`);

  const alice = new BotRadio('alice'); // squad lead: Command + FT
  const bob = new BotRadio('bob'); // rifleman: FT only
  const carol = new BotRadio('carol'); // platoon: Command only
  const dave = new BotRadio('dave'); // hears both
  await Promise.all([alice.tune(['Command', ft]), bob.tune([ft]), carol.tune(['Command']), dave.tune(['Command', ft])]);
  check('one user connected to 2 rooms at once', alice.rooms.size === 2 && dave.rooms.size === 2);
  await sleep(1500); // let subscriptions settle

  // Phase 1: Alice transmits on FT.
  alice.setTx(ft);
  [bob, carol, dave].forEach((b) => b.reset());
  const t1 = await alice.ptt(1500);
  await sleep(800);
  check('TX on FT: Bob (FT) hears', (bob.heard.get(ft) ?? 0) > 20, JSON.stringify(heard(bob)));
  check('TX on FT: Carol (Command only) hears nothing', carol.heard.size === 0, JSON.stringify(heard(carol)));
  check('TX on FT: Dave hears it on FT, not on Command', (dave.heard.get(ft) ?? 0) > 20 && !dave.heard.get('Command'), JSON.stringify(heard(dave)));
  const lat = (bob.firstHeardAt.get(ft) ?? NaN) - t1;
  check('key-up to first audio at listener (indicative)', lat < 1000, `${lat} ms`);

  // Phase 2: cycle TX to Command.
  const now = alice.cycleTx();
  [bob, carol, dave].forEach((b) => b.reset());
  await alice.ptt(1500);
  await sleep(800);
  check('cycle key moves TX to Command', now === 'Command', String(now));
  check('TX on Command: Carol hears', (carol.heard.get('Command') ?? 0) > 20, JSON.stringify(heard(carol)));
  check('TX on Command: Bob hears nothing', bob.heard.size === 0, JSON.stringify(heard(bob)));
  check('TX on Command: Dave hears it on Command only', (dave.heard.get('Command') ?? 0) > 20 && !dave.heard.get(ft), JSON.stringify(heard(dave)));

  // Phase 3: server-side enforcement. A listen-only token must not be able to publish.
  {
    const { channels } = await api(`/api/communities/${CID}/channels`, 'eve');
    const cmd = channels.find((c: any) => c.name === 'Command');
    // Listen-only isn't an MVP feature, so mint one directly with the server SDK to prove LiveKit enforces it.
    const at = new AccessToken(LK_KEY, LK_SECRET, { identity: 'eve-listen-only' });
    at.addGrant({ room: `g${CID}.ch${cmd.id}`, roomJoin: true, canSubscribe: true, canPublish: false });
    const room = new Room();
    await room.connect(LK_WS, await at.toJwt());
    const src = new AudioSource(RATE, 1);
    let rejected = false;
    try {
      const opts = new TrackPublishOptions();
      opts.source = TrackSource.SOURCE_MICROPHONE;
      await Promise.race([
        room.localParticipant!.publishTrack(LocalAudioTrack.createAudioTrack('mic', src), opts),
        sleep(5000).then(() => { throw new Error('timeout'); }),
      ]);
    } catch (e) {
      rejected = true;
      console.log('   publish refused:', String((e as Error).message).slice(0, 120));
    }
    const svc = new RoomServiceClient(LK_HTTP, LK_KEY, LK_SECRET);
    const eve = (await svc.listParticipants(`g${CID}.ch${cmd.id}`)).find((p) => p.identity === 'eve-listen-only');
    const evePublished = eve?.tracks.length ?? -1;
    check('listen-only token cannot transmit (server-enforced)', rejected && evePublished === 0, `publish rejected=${rejected}, server sees ${evePublished} tracks from eve`);
    await room.disconnect();
  }

  // Phase 3b: a non-admin can't create or delete channels.
  const denied = await fetch(`${API}/api/communities/${CID}/channels`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.get('bob')}` }, body: JSON.stringify({ freq: '33', name: 'Bobnet' }) });
  check('non-admin cannot create channels', denied.status === 403, String(denied.status));

  // Phase 4: admin deletes the FT channel -> everyone tuned to it is dropped.
  await api(`/api/communities/${CID}/channels/${created.channel.id}`, 'toby', { method: 'DELETE' });
  await sleep(1500);
  check('deleting channel drops tuned listeners', bob.disconnected.includes(ft) && alice.disconnected.includes(ft), `bob=${bob.disconnected} alice=${alice.disconnected}`);
  check('deleting channel leaves other channels connected', !alice.disconnected.includes('Command'));

  await Promise.all([alice, bob, carol, dave].map((b) => b.close()));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await dispose();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); process.exit(2); });
