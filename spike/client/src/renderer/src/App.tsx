import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { Keybinds } from '../../shared/types';
import { bridge, inElectron } from './bridge';
import { Api, type ChannelInfo, type CommunityInfo } from './lib/api';
import { RadioEngine, type RadioControl, type TunedChannel } from './lib/radioEngine';
import { isPreview } from './lib/previewMode';
import { PreviewApi } from './lib/previewApi';
import { PreviewEngine } from './lib/previewEngine';
import { matchChannel } from '../../shared/radialWheel';
import { parseFreqInput, validateFrequency } from './lib/freq';
import { RadialWheel } from './RadialWheel';
import { useChannelWheel } from './useChannelWheel';

const initials = (s: string) => s.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export function App() {
  const [api, setApi] = useState<Api | null>(null);
  const [me, setMe] = useState<{ displayName: string } | null>(null);
  const [communities, setCommunities] = useState<CommunityInfo[]>([]);
  const [active, setActive] = useState<CommunityInfo | null>(null);

  const refresh = useCallback(async (a: Api) => {
    const r = await a.me();
    setMe(r.account);
    setCommunities(r.communities);
    setActive((cur) => r.communities.find((c) => c.id === cur?.id) ?? r.communities[0] ?? null);
  }, []);

  useEffect(() => {
    if (isPreview) {
      const a = new PreviewApi();
      setApi(a);
      void refresh(a);
      return;
    }
    bridge.getToken().then(async (t) => {
      const a = new Api(t);
      setApi(a);
      if (t) await refresh(a).catch(() => setMe(null));
    });
  }, [refresh]);

  if (!api) return null;
  if (!me || !active)
    return <Onboarding api={api} signedIn={Boolean(me)} onDone={async (token) => { if (token) { api.token = token; await bridge.setToken(token); } await refresh(api); }} />;

  return (
    <div className="app">
      <div className="titlebar" />
      <nav className="rail">
        {communities.map((c) => (
          <button key={c.id} className={`c ${c.id === active.id ? 'on' : ''}`} title={c.name} onClick={() => setActive(c)}>{initials(c.name)}</button>
        ))}
        <button className="c add" title="Join or create a community" onClick={() => setMe(null)}>+</button>
      </nav>
      <Radio key={active.id} api={api} community={active} me={me.displayName} />
    </div>
  );
}

function Onboarding({ api, signedIn, onDone }: { api: Api; signedIn: boolean; onDone: (token?: string) => void }) {
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [community, setCommunity] = useState('');
  const [setup, setSetup] = useState('');
  const [err, setErr] = useState('');
  const go = async () => {
    setErr('');
    try {
      const r = mode === 'join'
        ? await api.join(code, signedIn ? undefined : name)
        : await api.createCommunity(community, signedIn ? undefined : name, setup || undefined);
      onDone(r.token);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="onboard">
      <div className="titlebar" />
      <div className="box">
        <h1>{mode === 'join' ? 'Join your net' : 'Start a community'}</h1>
        <p>{mode === 'join' ? 'Paste the invite code from your community admin.' : 'You’ll get an invite code to share with your group.'}</p>
        {mode === 'join'
          ? <label className="field">Invite code<input className="code" placeholder="ABCD-EF23" value={code} onChange={(e) => setCode(e.target.value)} /></label>
          : <>
              <label className="field">Community name<input placeholder="War Dogs NZ" value={community} onChange={(e) => setCommunity(e.target.value)} /></label>
              <label className="field">Setup code (from whoever runs the server)<input value={setup} onChange={(e) => setSetup(e.target.value)} /></label>
            </>}
        {!signedIn && <label className="field">Your callsign / display name<input placeholder="Toby" value={name} onChange={(e) => setName(e.target.value)} /></label>}
        {err && <div className="err">{err}</div>}
        <button className="btn primary" onClick={go}>{mode === 'join' ? 'Join' : 'Create community'}</button>
        <button className="btn ghost" onClick={() => setMode(mode === 'join' ? 'create' : 'join')}>
          {mode === 'join' ? 'Running a group? Create a community' : 'Have an invite? Join instead'}
        </button>
      </div>
    </div>
  );
}

function Radio({ api, community, me }: { api: Api; community: CommunityInfo; me: string }) {
  const engine: RadioControl = useMemo(
    () => (isPreview ? new PreviewEngine() : new RadioEngine(api, community.id)),
    [api, community.id],
  );
  useSyncExternalStore(engine.subscribe, () => engine.version);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [query, setQuery] = useState('');
  const [err, setErr] = useState('');
  const [binds, setBinds] = useState<Keybinds | null>(null);
  const [overlayOn, setOverlayOn] = useState(true);
  const [newCh, setNewCh] = useState(false);
  const isAdmin = community.role !== 'member';
  const storeKey = `rn.radio.${community.id}`;

  const load = useCallback(() => api.channels(community.id).then(setChannels).catch((e) => setErr(e.message)), [api, community.id]);
  const [restored, setRestored] = useState(false);

  // Load channel list, restore previously tuned channels, poll for admin changes.
  // Persistence waits until this finishes, otherwise the first empty render wipes the saved tune list.
  useEffect(() => {
    let alive = true;
    load().then(async () => {
      const saved: { tuned: string[]; tx: string | null } = JSON.parse(localStorage.getItem(storeKey) ?? '{"tuned":[],"tx":null}');
      const list = await api.channels(community.id);
      for (const id of saved.tuned) { const ch = list.find((c) => c.id === id); if (ch && alive) await engine.tune(ch).catch(() => undefined); }
      if (alive && saved.tx) engine.setTx(saved.tx);
      if (alive) setRestored(true);
    });
    const t = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(t); void engine.dispose(); };
  }, [api, community.id, engine, load, storeKey]);

  // Registered after the dispose effect so a pending tune is cancelled before the engine shuts down.
  const wheel = useChannelWheel(engine, channels);

  // Persist radio state once the saved tune list has been applied.
  useEffect(() => {
    if (!restored) return;
    localStorage.setItem(storeKey, JSON.stringify({ tuned: engine.tuned.map((t) => t.channel.id), tx: engine.txId }));
  });

  // Global hotkeys.
  useEffect(() => {
    bridge.defaultKeybinds().then((b) => { setBinds(b); void bridge.setKeybinds(b); });
    const off = bridge.onHotkey((e) => {
      if (e.type === 'ptt') void engine.ptt(e.down);
      if (e.type === 'cycle') engine.cycle();
      if (e.type === 'overlay') setOverlayOn((v) => !v);
      if (e.type === 'direct') void engine.ptt(e.down, e.channelId);
      if (e.type === 'wheel') wheel.onKey(e.down, e.heldMs);
      if (e.type === 'wheel-scroll') wheel.onFallbackScroll(e.steps, e.shift);
      if (e.type === 'wheel-number') wheel.onNumber(e.n);
      if (e.type === 'wheel-cancel') wheel.close();
    });
    const offWheel = bridge.onWheelInput(wheel.onInput);
    // Browser fallback: hold Space to talk while the window is focused.
    const kd = (e: KeyboardEvent) => { if (!inElectron && e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLInputElement)) void engine.ptt(true); };
    const ku = (e: KeyboardEvent) => { if (!inElectron && e.code === 'Space') void engine.ptt(false); };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    return () => { off(); offWheel(); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, [engine, wheel.onKey, wheel.onInput, wheel.onFallbackScroll, wheel.onNumber, wheel.close]);

  const tuned = engine.tuned;
  const tx = tuned.find((t) => t.channel.id === engine.txId) ?? null;
  const keyed = engine.transmittingOn !== null;
  // Overlay is on by default. Each row is someone transmitting: their name and that channel.
  // Include this user; the engine's speaker list is remote talkers only.
  const overlaySpeakers = tuned.flatMap((t) => {
    const names = [...t.speakers];
    if (engine.transmittingOn === t.channel.id && !names.includes(me)) names.unshift(me);
    return names.map((name) => ({ name, channel: t.channel.name, freq: t.channel.freq }));
  });

  // Talker rows hide while nobody is transmitting. The wheel can open on top of that.
  useEffect(() => {
    bridge.setOverlay({
      visible: overlayOn && overlaySpeakers.length > 0,
      speakers: overlaySpeakers,
      wheel: wheel.view,
    });
  });

  const tuneQuery = async () => {
    setErr('');
    const q = query.trim();
    if (!q) return;
    const kHz = parseFreqInput(q);
    const hit = channels.find((c) => c.id === matchChannel(q, channels)?.id);
    if (!hit) { setErr(kHz ? `Nothing on ${q} MHz yet${isAdmin ? ' — create it?' : ''}` : `No channel matches “${q}”`); return; }
    setQuery('');
    await engine.tune(hit).catch((e) => setErr(e.message));
  };

  const tunedIds = new Set(tuned.map((t) => t.channel.id));
  const filtered = channels.filter((c) => !query || c.freq.startsWith(query) || c.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <aside className="dir">
        <h2>{community.name}</h2>
        <div className="sub">{me} · {community.role}{community.inviteCode ? <> · invite <kbd>{community.inviteCode}</kbd></> : null}</div>
        <div className="tunebox">
          <span>📻</span>
          <input placeholder="Tune: 59.5 or Command" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && tuneQuery()} />
          <span className="hint">Enter</span>
        </div>
        {err && <div className="err" style={{ margin: '0 6px 8px' }}>{err}</div>}
        <div className="section"><span>Channels</span>{isAdmin && <button className="btn sm" onClick={() => setNewCh(true)}>+ New</button>}</div>
        <div className="chlist">
          {filtered.map((c) => (
            <div key={c.id} className={`ch ${tunedIds.has(c.id) ? 'tuned' : ''}`} onDoubleClick={() => engine.tune(c)}>
              <span className="f">{c.freq}</span>
              <span className="n">{c.name}</span>
              <span className="act">
                {tunedIds.has(c.id)
                  ? <span className="pill live">tuned</span>
                  : <button className="btn sm" onClick={() => engine.tune(c).catch((e) => setErr(e.message))}>Tune</button>}
                {isAdmin && <button className="btn sm ghost" title="Delete channel" onClick={async () => { if (confirm(`Delete ${c.freq} ${c.name} for everyone?`)) { await api.deleteChannel(community.id, c.id); await load(); } }}>🗑</button>}
              </span>
            </div>
          ))}
          {!filtered.length && <div className="sub" style={{ padding: 8 }}>No channels yet.</div>}
        </div>
        <div className="foot"><div className="avatar">{initials(me)}</div><div><div>{me}</div><div className="sub" style={{ margin: 0 }}>{inElectron ? 'Global hotkeys on' : 'Browser preview: hold Space'}</div></div></div>
      </aside>

      <main className="radio">
        <div className={`txbar ${keyed ? 'keyed' : ''}`}>
          <div>
            <div className="lbl">{keyed ? <span className="onair">On air</span> : 'Transmit on'}</div>
            <div className="big">{tx ? tx.channel.freq : '—'}</div>
          </div>
          <div className="nm">{tx?.channel.name ?? 'Tune a channel to talk'}</div>
          <div className="keys">
            Talk <kbd>{binds?.ptt?.label ?? '—'}</kbd> Wheel <kbd>{binds?.wheel?.label ?? '—'}</kbd> Overlay <kbd>{binds?.overlay?.label ?? '—'}</kbd>
          </div>
        </div>
        <div className="grid">
          {tuned.map((t) => <Card key={t.channel.id} t={t} engine={engine} />)}
          <div className="empty">
            <div><div style={{ fontSize: 28 }}>＋</div>Tune more channels from the list,<br />or type a frequency or name.</div>
          </div>
        </div>
      </main>
      {newCh && <NewChannel onClose={() => setNewCh(false)} onCreate={async (f, n) => {
        const kHz = parseFreqInput(f);
        const bad = kHz == null ? 'Enter a frequency like 59.5' : validateFrequency(kHz);
        if (bad) throw new Error(bad);
        await api.createChannel(community.id, f, n);
        await load();
        setNewCh(false);
      }} />}
      {!inElectron && wheel.open && createPortal(
        <RadialWheel segments={wheel.segments} adding={wheel.adding} addError={wheel.addError} onInput={wheel.onInput} />,
        document.body,
      )}
    </>
  );
}

function Card({ t, engine }: { t: TunedChannel; engine: RadioControl }) {
  const isTx = engine.txId === t.channel.id;
  const keyed = engine.transmittingOn === t.channel.id;
  return (
    <div className={`card ${isTx ? 'tx' : ''} ${keyed ? 'keyed' : ''} ${t.status === 'gone' ? 'gone' : ''}`}>
      <div className="top">
        <div>
          <div className="freq">{t.channel.freq}<small>MHz</small></div>
          <div className="name">{t.channel.name}</div>
        </div>
        <button className="x" title="Untune" onClick={() => engine.untune(t.channel.id)}>×</button>
      </div>
      <div className="who">
        {t.status === 'gone' ? 'Channel was deleted' : t.status !== 'live' ? `${t.status}…`
          : t.speakers.length ? <><span className="avatar talk">{initials(t.speakers[0])}</span><span className="talking">{t.speakers.join(', ')}</span></>
          : <span>{Math.max(t.listeners - 1, 0)} others tuned</span>}
      </div>
      <div className="row"><span className="k">🔊</span>
        <input type="range" min={0} max={1.5} step={0.05} value={t.muted ? 0 : t.volume} onChange={(e) => engine.setVolume(t.channel.id, Number(e.target.value))} />
        <button className="btn sm ghost" onClick={() => engine.setMuted(t.channel.id, !t.muted)}>{t.muted ? 'Unmute' : 'Mute'}</button>
      </div>
      <div className="bottom">
        <div className="seg">
          {([['L', -1], ['C', 0], ['R', 1]] as const).map(([l, v]) => (
            <button key={l} className={t.pan === v ? 'on' : ''} onClick={() => engine.setPan(t.channel.id, v)}>{l}</button>
          ))}
        </div>
        <button className={`txbtn ${isTx ? 'on' : ''}`} style={{ marginLeft: 'auto' }} disabled={!t.canTransmit} onClick={() => engine.setTx(t.channel.id)}>
          {isTx ? '● Transmitting here' : 'Transmit here'}
        </button>
      </div>
    </div>
  );
}

function NewChannel({ onClose, onCreate }: { onClose: () => void; onCreate: (freq: string, name: string) => Promise<void> }) {
  const [f, setF] = useState('');
  const [n, setN] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>New channel</h3>
        <label className="field">Frequency (MHz, 30.0–87.5, steps of 0.5)<input className="code" placeholder="59.5" value={f} onChange={(e) => setF(e.target.value)} /></label>
        <label className="field">Name<input placeholder="Command" value={n} onChange={(e) => setN(e.target.value)} /></label>
        {err && <div className="err">{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onCreate(f, n).catch((e) => setErr(e.message))}>Create</button>
        </div>
      </div>
    </div>
  );
}
