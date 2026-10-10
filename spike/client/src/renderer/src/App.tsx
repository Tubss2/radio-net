import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { cloneBinds, KEYBINDS_VERSION, migrateDesktopKeybinds, pageKeybinds } from '../../shared/keybinds';
import { emptyRadio, normaliseProfile, type Profile, type RadioPrefs, type ServerEntry } from '../../shared/profile';
import type { Keybinds } from '../../shared/types';
import { acceptChannelList, removedTunedIds } from '../../shared/channelList';
import { matchChannel } from '../../shared/radialWheel';
import { soundPrefsFrom, type SoundPrefs } from '../../shared/sounds';
import { playSquelch, setUiSounds } from './lib/uiSounds';
import { bridge, domEventMatchesBind, inElectron, isCapturingBind } from './bridge';
import { RECONNECTING } from '../../shared/net';
import { API_URL, Api, ApiError, isReconnectError, type ChannelInfo } from './lib/api';
import { parseFreqInput, validateFrequency } from './lib/freq';
import { isPreview } from './lib/previewMode';
import { PreviewApi } from './lib/previewApi';
import { PreviewEngine } from './lib/previewEngine';
import { RadioEngine, type RadioControl, type TunedChannel } from './lib/radioEngine';
import { isWeb } from './platform';
import { PhoneLink } from './PhoneLink';
import { HelperLink } from './HelperLink';
import { TalkSetup } from './TalkSetup';
import { RadialWheel } from './RadialWheel';
import { Settings } from './Settings';
import { SimpleRadio } from './SimpleRadio';
import { PrivacyConsent, PrivacyNotes } from './Privacy';
import { useChannelWheel } from './useChannelWheel';
import { useTalk } from './useTalk';

const initials = (s: string) => s.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

/** Shown after electron-updater has downloaded a build. Later hides it until the next check. */
function UpdateBar() {
  const [phase, setPhase] = useState<'available' | 'ready' | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => bridge.onUpdateAvailable((info) => { setVersion(info.version); setPhase('available'); }), []);
  useEffect(() => bridge.onUpdateReady((info) => { setVersion(info.version); setPhase('ready'); }), []);
  if (!version || !phase) return null;
  return (
    <div className="update-ready" role="status">
      <span>{phase === 'ready' ? 'Update downloaded' : 'Update available'}</span>
      <span className="ver">Radio Net {version} · unsigned</span>
      {phase === 'available'
        ? <button className="btn sm primary" type="button" onClick={() => bridge.downloadUpdate()}>Download</button>
        : <button className="btn sm primary" type="button" onClick={() => bridge.installUpdate()}>Restart now</button>}
      <button className="btn sm ghost" type="button" onClick={() => setPhase(null)}>Later</button>
    </div>
  );
}

function clientFor(server: { url?: string; token?: string | null; adminKey?: string | null } | null): Api {
  if (isPreview) return new PreviewApi();
  return new Api(server?.url || API_URL, server?.token ?? null, server?.adminKey ?? null);
}

export function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [binds, setBinds] = useState<Keybinds>(() => (inElectron ? cloneBinds() : pageKeybinds(null, isPreview)));
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [hotkeysOn, setHotkeysOn] = useState(true);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const profileRef = useRef<Profile | null>(null);

  const save = useCallback(async (next: Profile) => {
    profileRef.current = next;
    setProfile(next);
    setUiSounds(soundPrefsFrom(next));
    await bridge.setProfile(next);
  }, []);

  useEffect(() => {
    bridge.getProfile().then(async (raw) => {
      const p = normaliseProfile(raw);
      let nextProfile = p;
      let nextBinds: Keybinds;
      if (inElectron) {
        const migrated = migrateDesktopKeybinds(p.keybinds, p.keybindsVersion);
        nextBinds = migrated.keybinds ?? cloneBinds();
        if (migrated.changed) nextProfile = { ...p, keybinds: migrated.keybinds, keybindsVersion: migrated.version };
      } else {
        nextBinds = pageKeybinds(p.keybinds, isPreview);
      }
      profileRef.current = nextProfile;
      setProfile(nextProfile);
      setHotkeysOn(nextProfile.hotkeysEnabled);
      setUiSounds(soundPrefsFrom(nextProfile));
      setBinds(nextBinds);
      await bridge.setKeybinds(nextBinds);
      if (nextProfile !== p) await bridge.setProfile(nextProfile);
      if (p.privacyAccepted) await bridge.setHotkeysEnabled(p.hotkeysEnabled);
      if (isPreview && p.servers[0]) setActiveId(p.servers[0].id);
    });
  }, []);

  const setListening = (enabled: boolean) => {
    setHotkeysOn(enabled);
    const cur = profileRef.current;
    if (!cur) return;
    void save({ ...cur, hotkeysEnabled: enabled });
    void bridge.setHotkeysEnabled(enabled && cur.privacyAccepted);
  };

  const acceptPrivacy = () => {
    const cur = profileRef.current;
    if (!cur) return;
    setHotkeysOn(true);
    void save({ ...cur, privacyAccepted: true, hotkeysEnabled: true });
    void bridge.setHotkeysEnabled(true);
  };

  const changeBinds = (next: Keybinds) => {
    setBinds(next);
    void bridge.setKeybinds(next);
    if (profileRef.current) void save({ ...profileRef.current, keybinds: next, keybindsVersion: inElectron ? KEYBINDS_VERSION : profileRef.current.keybindsVersion });
  };

  if (!profile) return <UpdateBar />;
  if (!profile.privacyAccepted) return <><PrivacyConsent onAccept={acceptPrivacy} /><UpdateBar /></>;
  if (!profile.callsign) return <><Callsign onSave={(callsign) => void save({ ...profile, callsign })} /><UpdateBar /></>;

  const active = profile.servers.find((s) => s.id === activeId) ?? null;
  if (!active) {
    return (
      <>
        <Home
          profile={profile}
          hotkeysOn={hotkeysOn}
          onHotkeys={setListening}
          onPrivacy={() => setPrivacyOpen(true)}
          onProfile={(p) => void save(p)}
          onOpen={(server) => setActiveId(server.id)}
          onCreated={(server, adminKey) => { setFreshKey(adminKey); setActiveId(server.id); }}
        />
        {privacyOpen && <PrivacyNotes onClose={() => setPrivacyOpen(false)} />}
        <UpdateBar />
      </>
    );
  }

  return (
    <div className={`app${isWeb ? ' web' : ''}${!isWeb && profile.simpleOn ? ' simple' : ''}`}>
      <div className="titlebar" />
      <nav className="rail">
        {[...profile.servers].sort((a, b) => b.lastUsed.localeCompare(a.lastUsed)).map((c) => (
          <button key={c.id} className={`c ${c.id === active.id ? 'on' : ''}`} title={c.name} onClick={() => setActiveId(c.id)}>{initials(c.name)}</button>
        ))}
        <button className="c add" title="Servers" onClick={() => setActiveId(null)}>+</button>
      </nav>
      <Radio
        server={active}
        callsign={profile.callsign}
        binds={binds}
        boot={profile}
        hotkeysOn={hotkeysOn}
        onHotkeys={setListening}
        onProfile={(p) => void save(p)}
        onServer={(server) => {
          const cur = profileRef.current;
          if (!cur) return;
          void save({ ...cur, servers: cur.servers.map((s) => s.id === server.id ? server : s) });
        }}
        onRemoved={() => {
          const cur = profileRef.current;
          if (!cur) return;
          const radios = { ...cur.radios };
          delete radios[active.id];
          void save({ ...cur, servers: cur.servers.filter((s) => s.id !== active.id), radios });
          setActiveId(null);
        }}
      />
      <SettingsHost
        binds={binds}
        hotkeysOn={hotkeysOn}
        onHotkeys={setListening}
        onPrivacy={() => setPrivacyOpen(true)}
        sounds={soundPrefsFrom(profile)}
        onSounds={(sounds) => {
          const cur = profileRef.current;
          if (!cur) return;
          void save({ ...cur, soundsOn: sounds.addChannel, soundPtt: sounds.ptt, soundTx: sounds.txChange, soundVolume: sounds.volume });
        }}
        onChange={changeBinds}
      />
      {freshKey && <AdminKeyReveal adminKey={freshKey} inviteCode={active.inviteCode} onClose={() => setFreshKey(null)} />}
      {privacyOpen && <PrivacyNotes onClose={() => setPrivacyOpen(false)} />}
      <UpdateBar />
    </div>
  );
}

/** Settings is opened from inside Radio via a custom event so the radio tree can stay the owner of tuned channels. */
function SettingsHost({ binds, hotkeysOn, onHotkeys, onPrivacy, sounds, onSounds, onChange }: {
  binds: Keybinds;
  hotkeysOn: boolean;
  onHotkeys: (enabled: boolean) => void;
  onPrivacy: () => void;
  sounds: SoundPrefs;
  onSounds: (next: SoundPrefs) => void;
  onChange: (b: Keybinds) => void;
}) {
  const [open, setOpen] = useState(false);
  const [quick, setQuick] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ quick: { id: string; label: string }[] }>).detail;
      setQuick(detail?.quick ?? []);
      setOpen(true);
    };
    window.addEventListener('rn-settings', onOpen);
    return () => window.removeEventListener('rn-settings', onOpen);
  }, []);
  if (!open) return null;
  return <Settings binds={binds} quick={quick} hotkeysOn={hotkeysOn} onHotkeys={onHotkeys} onPrivacy={onPrivacy} sounds={sounds} onSounds={onSounds} onChange={onChange} onClose={() => setOpen(false)} />;
}

function Callsign({ onSave }: { onSave: (callsign: string) => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const go = () => {
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n || n.length > 32) { setErr('Pick a callsign (1-32 characters)'); return; }
    onSave(n);
  };
  return (
    <div className="onboard">
      <div className="titlebar" />
      <div className="box">
        <h1>Your callsign</h1>
        <p>Stored {isWeb ? 'in this browser' : 'on this PC'}. There is no account and nothing to sign in to.</p>
        <label className="field">Callsign<input placeholder="Toby" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} /></label>
        {err && <div className="err">{err}</div>}
        <button className="btn primary" onClick={go}>Continue</button>
      </div>
    </div>
  );
}

function Home({ profile, hotkeysOn, onHotkeys, onPrivacy, onProfile, onOpen, onCreated }: {
  profile: Profile;
  hotkeysOn: boolean;
  onHotkeys: (enabled: boolean) => void;
  onPrivacy: () => void;
  onProfile: (p: Profile) => void;
  onOpen: (server: ServerEntry) => void;
  onCreated: (server: ServerEntry, adminKey: string) => void;
}) {
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [code, setCode] = useState('');
  const [community, setCommunity] = useState('');
  const [setup, setSetup] = useState('');
  const [url, setUrl] = useState(API_URL);
  const [callsign, setCallsign] = useState(profile.callsign);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const joinExisting = async (server: ServerEntry) => {
    setErr('');
    setBusy(true);
    try {
      const name = callsign.trim().replace(/\s+/g, ' ');
      if (!name) throw new Error('Pick a callsign (1-32 characters)');
      const api = clientFor({ url: server.url, token: null, adminKey: server.adminKey ?? null });
      const r = await api.join(server.inviteCode, name);
      const entry: ServerEntry = {
        ...server,
        name: r.community.name,
        inviteCode: r.community.inviteCode,
        token: r.token,
        tokenExp: Date.parse(r.expiresAt),
        lastUsed: new Date().toISOString(),
      };
      const servers = [entry, ...profile.servers.filter((s) => s.id !== entry.id)];
      onProfile({ ...profile, callsign: name, servers });
      onOpen(entry);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const go = async () => {
    setErr('');
    setBusy(true);
    try {
      const name = callsign.trim().replace(/\s+/g, ' ');
      if (!name) throw new Error('Pick a callsign (1-32 characters)');
      const api = clientFor({ url, token: null, adminKey: null });
      if (mode === 'join') {
        const r = await api.join(code, name);
        const prev = profile.servers.find((s) => s.id === r.community.id);
        const entry: ServerEntry = {
          id: r.community.id,
          name: r.community.name,
          url,
          inviteCode: r.community.inviteCode,
          adminKey: prev?.adminKey,
          token: r.token,
          tokenExp: Date.parse(r.expiresAt),
          lastUsed: new Date().toISOString(),
        };
        const servers = [entry, ...profile.servers.filter((s) => s.id !== entry.id)];
        onProfile({ ...profile, callsign: name, servers });
        onOpen(entry);
      } else {
        const created = await api.createCommunity(community, setup || undefined);
        const joined = await api.join(created.community.inviteCode, name);
        const entry: ServerEntry = {
          id: created.community.id,
          name: created.community.name,
          url,
          inviteCode: created.community.inviteCode,
          adminKey: created.adminKey,
          token: joined.token,
          tokenExp: Date.parse(joined.expiresAt),
          lastUsed: new Date().toISOString(),
        };
        const servers = [entry, ...profile.servers.filter((s) => s.id !== entry.id)];
        onProfile({ ...profile, callsign: name, servers });
        onCreated(entry, created.adminKey);
      }
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const history = [...profile.servers].sort((a, b) => b.lastUsed.localeCompare(a.lastUsed));

  return (
    <div className="onboard">
      <div className="titlebar" />
      <div className="box servers">
        <h1>{mode === 'join' ? 'Join a server' : 'Start a community'}</h1>
        <p>{mode === 'join' ? `Use the invite code from your community. Servers you have joined stay ${isWeb ? 'in this browser' : 'on this PC'}.` : `You get an invite code for the group, and an admin key. ${isWeb ? 'This browser keeps that key only if you ask it to.' : 'The admin key stays on this PC.'}`}</p>
        <label className="field">Callsign<input placeholder="Toby" value={callsign} onChange={(e) => setCallsign(e.target.value)} /></label>
        {history.length > 0 && mode === 'join' && (
          <div className="history">
            {history.map((s) => (
              <div key={s.id} className="server">
                <div>
                  <div>{s.name}</div>
                  <div className="sub" style={{ margin: 0 }}>Invite {s.inviteCode}</div>
                </div>
                <button className="btn sm" disabled={busy} onClick={() => void joinExisting(s)}>Rejoin</button>
              </div>
            ))}
          </div>
        )}
        {mode === 'join'
          ? <label className="field">Invite code<input className="code" placeholder="ABCD-EF23" value={code} onChange={(e) => setCode(e.target.value)} /></label>
          : <>
              <label className="field">Community name<input placeholder="War Dogs NZ" value={community} onChange={(e) => setCommunity(e.target.value)} /></label>
              <label className="field">Setup code (from whoever runs the server)<input value={setup} onChange={(e) => setSetup(e.target.value)} /></label>
            </>}
        <label className="field">Server<input placeholder={API_URL} value={url} onChange={(e) => setUrl(e.target.value)} /></label>
        {err && <div className="err">{err}</div>}
        <button className="btn primary" disabled={busy} onClick={() => void go()}>{mode === 'join' ? 'Join' : 'Create community'}</button>
        <button className="btn ghost" onClick={() => { setMode(mode === 'join' ? 'create' : 'join'); setErr(''); }}>
          {mode === 'join' ? 'Running a group? Create a community' : 'Have an invite? Join instead'}
        </button>
        <div className="row">
          <button className="btn sm ghost" type="button" onClick={() => onHotkeys(!hotkeysOn)}>{hotkeysOn ? 'Keybinds on' : 'Keybinds paused'}</button>
          <button className="btn sm ghost" type="button" onClick={onPrivacy}>Privacy notes</button>
        </div>
      </div>
    </div>
  );
}

function AdminKeyReveal({ adminKey, inviteCode, onClose }: { adminKey: string; inviteCode: string; onClose: () => void }) {
  const [copied, setCopied] = useState<'invite' | 'admin' | null>(null);
  const copy = async (which: 'invite' | 'admin', value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(which); } catch { setCopied(null); }
  };
  return (
    <div className="modal-bg">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>Community is ready</h3>
        <p className="sub" style={{ margin: 0 }}>Share the invite code. Other people join with it.</p>
        <div className="lbl">Invite code</div>
        <div className="keybox invite-code">{inviteCode}</div>
        <div className="lbl">Admin key</div>
        <p className="sub" style={{ margin: 0 }}>{isWeb
          ? 'This is shown once. This browser forgets it when you close the tab, unless you tick “Keep the admin key in this browser” on the radio. A script on this site can read a key you choose to keep. Copy it if another admin needs it. There is no account to recover it; the server setup code can mint a new one.'
          : 'This is shown once. It is saved on this PC. Copy it if another admin should be able to create channels. There is no account to recover it; the server setup code can mint a new one.'}</p>
        <div className="keybox">{adminKey}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button className="btn ghost" type="button" onClick={() => void copy('invite', inviteCode)}>{copied === 'invite' ? 'Invite copied' : 'Copy invite'}</button>
          <button className="btn ghost" type="button" onClick={() => void copy('admin', adminKey)}>{copied === 'admin' ? 'Admin key copied' : 'Copy admin key'}</button>
          <button className="btn primary" type="button" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function talkKeyLabel(code: string): string {
  if (code === 'Space') return 'Space';
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

function Radio({ server, callsign, binds, boot, hotkeysOn, onHotkeys, onProfile, onServer, onRemoved }: {
  server: ServerEntry;
  callsign: string;
  binds: Keybinds;
  boot: Profile;
  hotkeysOn: boolean;
  onHotkeys: (enabled: boolean) => void;
  onProfile: (p: Profile) => void;
  onServer: (s: ServerEntry) => void;
  onRemoved: () => void;
}) {
  const api = useMemo(
    () => clientFor(server),
    [server.id, server.url, server.token, server.adminKey],
  );
  const engine: RadioControl = useMemo(
    () => (isPreview ? new PreviewEngine() : new RadioEngine(api, server.id)),
    [api, server.id],
  );
  useSyncExternalStore(engine.subscribe, () => engine.version);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [listReady, setListReady] = useState(false);
  const [query, setQuery] = useState('');
  const [err, setErr] = useState('');
  const [overlayOn, setOverlayOn] = useState(boot.overlayOn);
  const [newCh, setNewCh] = useState(false);
  const [restored, setRestored] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [deleteSupported, setDeleteSupported] = useState(true);
  const isAdmin = Boolean(server.adminKey);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [helperSlot, setHelperSlot] = useState<HTMLDivElement | null>(null);
  const [phoneLinked, setPhoneLinked] = useState(false);
  const [helperLinked, setHelperLinked] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [arming, setArming] = useState(false);
  const [simpleOn, setSimpleOn] = useState(boot.simpleOn);
  const [onTop, setOnTop] = useState(boot.simpleOnTop);
  const externalDown = useRef(false);
  const talk = useTalk({
    enabled: isWeb,
    engine,
    talkKey: boot.talkKey,
    mode: boot.talkMode,
    sensitivity: boot.voiceSensitivity,
    releaseMs: boot.voiceReleaseMs,
    externalDown,
  });
  const bootRef = useRef(boot);
  const profileRef = useRef(boot);
  profileRef.current = boot;
  const loadGen = useRef(0);

  const load = useCallback(() => {
    const gen = ++loadGen.current;
    return api.channels(server.id).then((list) => {
      const accepted = acceptChannelList(gen, loadGen.current, list);
      if (accepted) {
        setChannels(accepted);
        setListReady(true);
        setErr((cur) => cur === RECONNECTING ? '' : cur);
      }
      return list;
    }).catch((e) => {
      if (gen === loadGen.current) setErr(isReconnectError(e) ? RECONNECTING : (e as Error).message);
      throw e;
    });
  }, [api, server.id]);

  useEffect(() => {
    if (!isAdmin || isPreview) return;
    let alive = true;
    // A dummy id never matches a community. A route 404 means this server has no delete.
    api.deleteCommunity('rn-route-probe').catch((e) => {
      if (alive && e instanceof ApiError && e.routeMissing) setDeleteSupported(false);
    });
    return () => { alive = false; };
  }, [api, isAdmin]);

  useEffect(() => {
    let alive = true;
    const saved = bootRef.current.radios[server.id] ?? emptyRadio();
    setOverlayOn(bootRef.current.overlayOn);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const boot = async () => {
      while (alive) {
        const gen = ++loadGen.current;
        try {
          const list = await api.channels(server.id);
          if (!alive) return;
          const accepted = acceptChannelList(gen, loadGen.current, list);
          // A delete landed while this fetch was in flight. That path owns the list now.
          if (!accepted) { if (alive) setRestored(true); return; }
          setChannels(accepted);
          setListReady(true);
          setErr((cur) => cur === RECONNECTING ? '' : cur);
          for (const id of saved.tuned) {
            if (!alive || gen !== loadGen.current) { if (alive) setRestored(true); return; }
            const ch = accepted.find((c) => c.id === id);
            if (!ch) continue;
            await engine.tune(ch).catch((e) => { if (isReconnectError(e)) throw e; });
            if (saved.volume[id] != null) engine.setVolume(id, saved.volume[id]);
            if (saved.muted[id]) engine.setMuted(id, true);
            if (saved.pan[id] != null) engine.setPan(id, saved.pan[id]);
          }
          if (alive && gen === loadGen.current && saved.tx) engine.setTx(saved.tx);
          if (alive) setRestored(true);
          return;
        } catch (e) {
          if (!alive) return;
          const msg = (e as Error).message ?? '';
          if (!isPreview && /session expired|not signed in/i.test(msg)) {
            try {
              const again = await new Api(server.url, null, server.adminKey ?? null).join(server.inviteCode, callsign);
              onServer({ ...server, token: again.token, tokenExp: Date.parse(again.expiresAt), lastUsed: new Date().toISOString() });
              return;
            } catch (err) {
              if (isReconnectError(err)) { setErr(RECONNECTING); await wait(2000); continue; }
              setErr((err as Error).message);
              return;
            }
          }
          if (isReconnectError(e)) { setErr(RECONNECTING); await wait(2000); continue; }
          setErr(msg);
          return;
        }
      }
    };
    void boot();
    const t = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(t); void engine.dispose(); };
  }, [api, server.id, engine, load]);

  const tuneChannel = async (ch: ChannelInfo) => {
    const fresh = !engine.tuned.some((t) => t.channel.id === ch.id);
    await engine.tune(ch);
    if (fresh) playSquelch();
  };

  const wheel = useChannelWheel(engine, channels, binds.wheel, {
    canCreate: isAdmin,
    listReady,
    createChannel: async (freq, name) => {
      const ch = await api.createChannel(server.id, freq, name);
      await load();
      return ch;
    },
  });
  const bindsRef = useRef(binds);
  bindsRef.current = binds;

  // The list is the server's channel set. Anything tuned that is no longer in it was deleted:
  // leave the LiveKit room, drop the card, and let the saved radio prefs forget the id.
  useEffect(() => {
    if (!listReady) return;
    for (const id of removedTunedIds(engine.tuned.map((t) => t.channel.id), channels.map((c) => c.id))) {
      void engine.untune(id);
    }
  }, [channels, listReady, engine]);

  useEffect(() => {
    engine.onChannelDeleted = (id) => {
      loadGen.current += 1;
      setChannels((prev) => prev.filter((c) => c.id !== id));
      void load();
    };
    return () => { engine.onChannelDeleted = undefined; };
  }, [engine, load]);

  useEffect(() => {
    if (!restored) return;
    const prefs: RadioPrefs = {
      tuned: engine.tuned.map((t) => t.channel.id),
      tx: engine.txId,
      volume: Object.fromEntries(engine.tuned.map((t) => [t.channel.id, t.volume])),
      muted: Object.fromEntries(engine.tuned.map((t) => [t.channel.id, t.muted])),
      pan: Object.fromEntries(engine.tuned.map((t) => [t.channel.id, t.pan])),
    };
    const prev = profileRef.current.radios[server.id];
    if (JSON.stringify(prev) === JSON.stringify(prefs) && profileRef.current.overlayOn === overlayOn) return;
    const next = { ...profileRef.current, overlayOn, radios: { ...profileRef.current.radios, [server.id]: prefs } };
    profileRef.current = next;
    onProfile(next);
  });

  useEffect(() => {
    const off = bridge.onHotkey((e) => {
      if (e.type === 'ptt') void engine.ptt(e.down);
      if (e.type === 'cycle') engine.cycle(e.step === -1 ? -1 : 1);
      if (e.type === 'overlay') setOverlayOn((v) => !v);
      if (e.type === 'direct') void engine.ptt(e.down, e.channelId);
      if (e.type === 'select') engine.setTx(e.channelId);
      if (e.type === 'wheel') wheel.onKey(e.down, e.heldMs);
      if (e.type === 'wheel-scroll') wheel.onFallbackScroll(e.steps, e.shift);
      if (e.type === 'wheel-number') wheel.onNumber(e.n);
      if (e.type === 'wheel-cancel') wheel.close();
    });
    const offWheel = bridge.onWheelInput(wheel.onInput);
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const kd = (e: KeyboardEvent) => {
      if (inElectron || isCapturingBind() || typing(e)) return;
      if (e.code === 'Space' && !e.repeat) void engine.ptt(true);
      if (domEventMatchesBind(e, bindsRef.current.overlay)) { e.preventDefault(); setOverlayOn((v) => !v); }
      for (const [id, b] of Object.entries(bindsRef.current.select)) {
        if (domEventMatchesBind(e, b)) engine.setTx(id);
      }
    };
    const ku = (e: KeyboardEvent) => { if (!inElectron && e.code === 'Space') void engine.ptt(false); };
    window.addEventListener('keydown', kd, true); window.addEventListener('keyup', ku, true);
    return () => { off(); offWheel(); window.removeEventListener('keydown', kd, true); window.removeEventListener('keyup', ku, true); };
  }, [engine, wheel.onKey, wheel.onInput, wheel.onFallbackScroll, wheel.onNumber, wheel.close]);

  const tuned = engine.tuned;
  const tx = tuned.find((t) => t.channel.id === engine.txId) ?? null;
  const keyed = engine.transmittingOn !== null;
  const overlaySpeakers = tuned.flatMap((t) => {
    const names = [...t.speakers];
    if (engine.transmittingOn === t.channel.id && !names.includes(callsign)) names.unshift(callsign);
    return names.map((name) => ({ name, channel: t.channel.name, freq: t.channel.freq }));
  });

  useEffect(() => {
    bridge.setOverlay({
      visible: overlayOn && overlaySpeakers.length > 0,
      speakers: overlaySpeakers,
      wheel: wheel.view,
    });
  });
  useEffect(() => () => { bridge.setOverlay({ visible: false, speakers: [] }); }, []);

  const tuneQuery = async () => {
    setErr('');
    const q = query.trim();
    if (!q) return;
    const kHz = parseFreqInput(q);
    const hit = channels.find((c) => c.id === matchChannel(q, channels)?.id);
    if (!hit) { setErr(kHz ? `Nothing on ${q} MHz yet${isAdmin ? ' — create it?' : ''}` : `No channel matches “${q}”`); return; }
    setQuery('');
    await tuneChannel(hit).catch((e) => setErr(isReconnectError(e) ? RECONNECTING : (e as Error).message));
  };

  const openSettings = () => {
    const quick = tuned.map((t) => ({ id: `select:${t.channel.id}`, label: `Quick select ${t.channel.freq} ${t.channel.name}` }));
    window.dispatchEvent(new CustomEvent('rn-settings', { detail: { quick } }));
  };

  const copyAdmin = async () => {
    if (!server.adminKey) return;
    try { await navigator.clipboard.writeText(server.adminKey); setCopiedKey(true); }
    catch { setErr(server.adminKey); }
  };

  const copyInvite = async () => {
    if (!server.inviteCode) return;
    try { await navigator.clipboard.writeText(server.inviteCode); setCopiedInvite(true); }
    catch { setCopiedInvite(false); }
  };

  const rotateInvite = async () => {
    if (!confirm('Replace the invite code? Anyone with the old code has to join again.')) return;
    try {
      const r = await api.rotateInvite(server.id);
      onServer({ ...server, inviteCode: r.inviteCode });
      setCopiedInvite(false);
    } catch (e) {
      setErr(isReconnectError(e) ? RECONNECTING : (e as Error).message);
    }
  };

  const deleteChannel = async (ch: ChannelInfo) => {
    if (!confirm(`Delete ${ch.freq} ${ch.name} for everyone?`)) return;
    try {
      await api.deleteChannel(server.id, ch.id);
    } catch (e) {
      if (e instanceof ApiError && e.routeMissing) { setDeleteSupported(false); return; }
      setErr(isReconnectError(e) ? RECONNECTING : (e as Error).message);
      return;
    }
    // Invalidate a list fetch that started before the delete, then drop the channel locally
    // so the sidebar, the tuned card, and the wheel update without waiting for the next poll.
    loadGen.current += 1;
    setChannels((prev) => prev.filter((c) => c.id !== ch.id));
    setListReady(true);
    try { await load(); } catch { /* load records the error */ }
  };

  const removeCommunity = async () => {
    if (!confirm(`Delete ${server.name} for everyone? Its channels go with it.`)) return;
    try {
      await api.deleteCommunity(server.id);
      onRemoved();
    } catch (e) {
      if (e instanceof ApiError && e.routeMissing) { setDeleteSupported(false); return; }
      if (e instanceof ApiError && e.status === 404) { onRemoved(); return; }
      setErr(isReconnectError(e) ? RECONNECTING : (e as Error).message);
    }
  };

  useEffect(() => {
    if (!inElectron) return;
    bridge.setSimpleWindow({ compact: simpleOn, alwaysOnTop: simpleOn && onTop });
  }, [simpleOn, onTop]);

  const patchProfile = (patch: Partial<Profile>) => onProfile({ ...profileRef.current, ...patch });
  const armKey = () => {
    setArming(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener('keydown', onKey, true);
      setArming(false);
      if (e.key === 'Escape') return;
      patchProfile({ talkKey: e.code });
    };
    window.addEventListener('keydown', onKey, true);
  };

  const tunedIds = new Set(tuned.map((t) => t.channel.id));
  const filtered = channels.filter((c) => !query || c.freq.startsWith(query) || c.name.toLowerCase().includes(query.toLowerCase()));
  const talkLabel = talk.hardwareMuted ? 'Mic muted' : boot.talkMode === 'voice' ? 'Voice' : talkKeyLabel(boot.talkKey);
  const wheelPortal = !inElectron && wheel.open ? createPortal(
    <RadialWheel segments={wheel.segments} adding={wheel.adding} addError={wheel.addError} available={wheel.available} canCreate={wheel.canCreate} onInput={wheel.onInput} />,
    document.body,
  ) : null;

  const channelList = (
    <div className="chlist">
      {filtered.map((c) => (
        <div key={c.id} className={`ch ${tunedIds.has(c.id) ? 'tuned' : ''}`} onDoubleClick={() => { void tuneChannel(c).catch((e) => setErr(isReconnectError(e) ? RECONNECTING : (e as Error).message)); }}>
          <span className="f">{c.freq}</span>
          <span className="n">{c.name}</span>
          <span className="act">
            {tunedIds.has(c.id)
              ? <span className="pill live">tuned</span>
              : <button className="btn sm" onClick={() => { void tuneChannel(c).catch((e) => setErr(isReconnectError(e) ? RECONNECTING : (e as Error).message)); }}>Tune</button>}
            {isAdmin && <button className="btn sm ghost" title="Delete channel" onClick={() => { void deleteChannel(c); }}>🗑</button>}
          </span>
        </div>
      ))}
      {!filtered.length && <div className="sub" style={{ padding: 8 }}>No channels yet.</div>}
    </div>
  );

  if (isWeb) {
    return (
      <div className={`web-main${keyed ? ' on-air' : ''}`}>
        <OnAirBanner engine={engine} />
        <section className="invite-card">
          <div>
            <div className="lbl">Invite code</div>
            <p className="sub" style={{ margin: 0 }}>Share this so other people can join {server.name}.</p>
          </div>
          <div className="invite-code">{server.inviteCode || 'None saved in this browser'}</div>
          <div className="invite-actions">
            {server.inviteCode ? <button className="btn sm" type="button" onClick={() => void copyInvite()}>{copiedInvite ? 'Copied' : 'Copy invite'}</button> : null}
            {isAdmin ? <button className="btn sm" type="button" onClick={() => void rotateInvite()}>New invite</button> : null}
          </div>
          {isAdmin ? (
            <p className="sub" style={{ margin: 0 }}>
              <label>
                <input type="checkbox" checked={server.rememberAdmin === true} onChange={(e) => onServer({ ...server, rememberAdmin: e.target.checked })} />
                {' '}Keep the admin key in this browser. A script on this site can read it.
              </label>
              {server.rememberAdmin ? <> <button className="link" type="button" onClick={() => onServer({ ...server, rememberAdmin: false, adminKey: undefined })}>Forget admin key</button></> : null}
            </p>
          ) : (
            <p className="sub" style={{ margin: 0 }}>A new invite needs the admin key from the person who created this community.</p>
          )}
        </section>
        <TalkSetup
          talkMode={boot.talkMode}
          talkLabel={talkKeyLabel(boot.talkKey)}
          phoneLinked={phoneLinked}
          helperLinked={helperLinked}
          onBrowser={() => setTalkOpen(true)}
          onPhone={() => setPhoneOpen(true)}
          onHelperSlot={setHelperSlot}
        />
        <p className="notice">Use a phone, the Windows helper, or the desktop app for in-game push-to-talk. This page transmits only while the tab is in front. The microphone opens when you tune a channel and stays muted until you hold the button.</p>
        <div className="web-bar">
          <strong>{server.name}</strong>
          <span className="sub">{callsign}</span>
          <button className="btn sm" type="button" onClick={() => setChannelsOpen((v) => !v)}>{channelsOpen ? 'Radio' : 'Channels'}</button>
          <button className="btn sm" type="button" onClick={openSettings}>Sounds</button>
          {isAdmin && <button className="btn sm" type="button" onClick={() => setNewCh(true)}>+ New</button>}
          {!isPreview && (
            <PhoneLink
              api={api}
              cid={server.id}
              apiBase={server.url || API_URL}
              electron={inElectron}
              engine={engine}
              externalDown={externalDown}
              showButton={false}
              opened={phoneOpen}
              onOpenedChange={setPhoneOpen}
              onLinked={setPhoneLinked}
            />
          )}
          {!isPreview && (
            <HelperLink
              engine={engine}
              externalDown={externalDown}
              slot={helperSlot}
              onLinked={setHelperLinked}
            />
          )}
        </div>
        {err && <div className="err">{err}</div>}
        {talkOpen && (
          <div className="talk-settings">
            <label><input type="radio" name="talk" checked={boot.talkMode === 'hold'} onChange={() => patchProfile({ talkMode: 'hold' })} /> Hold to talk</label>
            <button className="btn sm" onClick={armKey}>{arming ? 'Press a key…' : talkKeyLabel(boot.talkKey)}</button>
            <label><input type="radio" name="talk" checked={boot.talkMode === 'voice'} onChange={() => { void engine.unlock(); patchProfile({ talkMode: 'voice' }); }} /> Voice</label>
            <label>Sensitivity
              <input type="range" min={0} max={100} value={Math.round(boot.voiceSensitivity * 100)} onChange={(e) => patchProfile({ voiceSensitivity: Number(e.target.value) / 100 })} />
            </label>
            <label>Release
              <input type="range" min={50} max={1000} step={50} value={boot.voiceReleaseMs} onChange={(e) => patchProfile({ voiceReleaseMs: Number(e.target.value) })} />
              <span className="sub">{boot.voiceReleaseMs} ms</span>
            </label>
          </div>
        )}
        {channelsOpen ? (
          <>
            <div className="tunebox">
              <input placeholder="Tune: 59.5 or Command" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && tuneQuery()} />
            </div>
            {channelList}
          </>
        ) : (
          <SimpleRadio engine={engine} onDown={talk.pointerDown} onUp={talk.pointerUp} label={talkLabel} />
        )}
        {newCh && <NewChannel onClose={() => setNewCh(false)} onCreate={async (f, n) => {
          const kHz = parseFreqInput(f);
          const bad = kHz == null ? 'Enter a frequency like 59.5 or 50' : validateFrequency(kHz);
          if (bad) throw new Error(bad);
          await api.createChannel(server.id, f, n);
          await load();
          setNewCh(false);
        }} />}
        {wheelPortal}
      </div>
    );
  }

  if (inElectron && simpleOn) {
    return (
      <div className={`simple-screen${keyed ? ' on-air' : ''}`}>
        <OnAirBanner engine={engine} />
        <div className="web-bar">
          <strong>{server.name}</strong>
          <button className="btn sm" onClick={() => { setSimpleOn(false); patchProfile({ simpleOn: false }); }}>Full radio</button>
          {!isPreview && <PhoneLink api={api} cid={server.id} apiBase={server.url || API_URL} electron={inElectron} engine={engine} externalDown={externalDown} />}
          <label className="sub"><input type="checkbox" checked={onTop} onChange={(e) => { setOnTop(e.target.checked); patchProfile({ simpleOnTop: e.target.checked }); }} /> Always on top</label>
        </div>
        <SimpleRadio engine={engine} onDown={() => { void engine.ptt(true); }} onUp={() => { void engine.ptt(false); }} label={binds.ptt?.label ?? 'Hold'} />
      </div>
    );
  }

  return (
    <>
      <aside className="dir">
        <h2>{server.name}</h2>
        <div className="sub">
          {callsign}
          {server.inviteCode ? <> · invite <kbd>{server.inviteCode}</kbd></> : null}
          {isAdmin ? <> · <button className="link" onClick={() => void rotateInvite()}>new invite</button> · <button className="link" onClick={() => void copyAdmin()}>{copiedKey ? 'admin key copied' : 'copy admin key'}</button>{deleteSupported ? <> · <button className="link" onClick={() => void removeCommunity()}>delete community</button></> : null}</> : null}
        </div>
        <div className="tunebox">
          <span>📻</span>
          <input placeholder="Tune: 59.5 or Command" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && tuneQuery()} />
          <span className="hint">Enter</span>
        </div>
        {err && <div className="err" style={{ margin: '0 6px 8px' }}>{err}</div>}
        <div className="section"><span>Channels</span>{isAdmin && <button className="btn sm" onClick={() => setNewCh(true)}>+ New</button>}</div>
        <div className="chlist">
          {filtered.map((c) => (
            <div key={c.id} className={`ch ${tunedIds.has(c.id) ? 'tuned' : ''}`} onDoubleClick={() => { void tuneChannel(c).catch((e) => setErr(isReconnectError(e) ? RECONNECTING : (e as Error).message)); }}>
              <span className="f">{c.freq}</span>
              <span className="n">{c.name}</span>
              <span className="act">
                {tunedIds.has(c.id)
                  ? <span className="pill live">tuned</span>
                  : <button className="btn sm" onClick={() => { void tuneChannel(c).catch((e) => setErr(isReconnectError(e) ? RECONNECTING : (e as Error).message)); }}>Tune</button>}
                {isAdmin && <button className="btn sm ghost" title="Delete channel" onClick={() => { void deleteChannel(c); }}>🗑</button>}
              </span>
            </div>
          ))}
          {!filtered.length && <div className="sub" style={{ padding: 8 }}>No channels yet.</div>}
        </div>
        <div className="foot">
          <div className="avatar">{initials(callsign)}</div>
          <div style={{ flex: 1 }}>
            <div>{callsign}</div>
            <button className="link" type="button" onClick={() => onHotkeys(!hotkeysOn)}>
              {inElectron ? (hotkeysOn ? 'Keybinds on — bound keys only' : 'Keybinds paused') : (hotkeysOn ? 'Preview: hold Space' : 'Keybinds paused')}
            </button>
          </div>
          {inElectron && <button className="btn sm" onClick={() => { setSimpleOn(true); patchProfile({ simpleOn: true }); }}>Simple</button>}
          {!isPreview && <PhoneLink api={api} cid={server.id} apiBase={server.url || API_URL} electron={inElectron} engine={engine} externalDown={externalDown} />}
          <button className="btn sm" onClick={openSettings}>Keybinds</button>
        </div>
      </aside>

      <main className={`radio${keyed ? ' on-air' : ''}`}>
        <OnAirBanner engine={engine} />
        <div className={`txbar ${keyed ? 'keyed' : ''}`}>
          <div>
            <div className="lbl">{keyed ? <span className="onair">Transmitting</span> : 'Transmit on'}</div>
            <div className="big">{tx ? tx.channel.freq : '—'}</div>
          </div>
          <div className="nm">{tx?.channel.name ?? 'Tune a channel to talk'}</div>
          <div className="keys">
            Talk <kbd>{binds.ptt?.label ?? '—'}</kbd>
            {binds.prev ? <> Prev <kbd>{binds.prev.label}</kbd></> : null}
            {binds.next ? <> Next <kbd>{binds.next.label}</kbd></> : null}
            {' '}Wheel <kbd>{binds.wheel?.label ?? '—'}</kbd> Overlay <kbd>{binds.overlay?.label ?? '—'}</kbd>
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
        const bad = kHz == null ? 'Enter a frequency like 59.5 or 50' : validateFrequency(kHz);
        if (bad) throw new Error(bad);
        await api.createChannel(server.id, f, n);
        await load();
        setNewCh(false);
      }} />}
      {wheelPortal}
    </>
  );
}

function OnAirBanner({ engine }: { engine: RadioControl }) {
  const id = engine.transmittingOn;
  if (!id) return null;
  const row = engine.tuned.find((t) => t.channel.id === id);
  return (
    <div className="onair-banner" role="status">
      <span className="onair">Transmitting</span>
      <strong className="freq">{row?.channel.freq ?? '—'}</strong>
      <span>{row?.channel.name ?? ''}</span>
    </div>
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
        {t.status === 'gone' ? 'Channel was deleted' : t.status === 'reconnecting' ? RECONNECTING : t.status !== 'live' ? `${t.status}…`
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
