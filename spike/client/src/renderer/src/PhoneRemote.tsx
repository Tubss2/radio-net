import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import { API_URL, Api } from './lib/api';
import { resolveLivekitUrl } from './lib/livekitUrl';
import {
  decodePhone, encodePhone, formatCodeClock, phoneChannelNote, phoneExpiryNote, phoneHold, phoneRedeemError,
  type PhonePhase, type PhoneState,
} from '../../shared/phonePage';

/** The page a paired phone opens. It sends hold and channel changes. It does not publish a microphone. */
export function PhoneRemote({ code, apiBase, expiresAt }: { code: string; apiBase: string | null; expiresAt: number | null }) {
  const [status, setStatus] = useState('Not connected yet');
  const [phase, setPhase] = useState<PhonePhase>('idle');
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [state, setState] = useState<PhoneState>({ t: 'state', tx: null, channels: [], on: false });
  const [install, setInstall] = useState<(() => void) | null>(null);
  const roomRef = useRef<Room | null>(null);
  const held = useRef(false);
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const send = (down: boolean) => {
    const room = roomRef.current;
    if (!room || room.state !== 'connected') return;
    void room.localParticipant.publishData(encodePhone({ t: 'ptt', down }), { reliable: true, topic: 'rn' });
  };

  const hold = (down: boolean) => {
    if (phaseRef.current !== 'live') return;
    if (down) {
      if (held.current) return;
      held.current = true;
      send(true);
      repeat.current = setInterval(() => send(true), 400);
      return;
    }
    if (!held.current) return;
    held.current = false;
    if (repeat.current) clearInterval(repeat.current);
    repeat.current = null;
    send(false);
  };

  const connect = () => {
    setStatus('Connecting…');
    setPhase('connecting');
    setAttempt((n) => n + 1);
    void navigator.wakeLock?.request('screen').catch(() => undefined);
  };

  useEffect(() => {
    if (phase === 'live' || phase === 'connecting') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const take = () => {
      if (phaseRef.current === 'idle') return;
      void navigator.wakeLock?.request('screen').then((sentinel) => { lock = sentinel; }).catch(() => undefined);
    };
    const vis = () => { if (document.hidden) hold(false); else take(); };
    document.addEventListener('visibilitychange', vis);
    const onInstall = (event: Event) => {
      event.preventDefault();
      const prompt = event as Event & { prompt: () => void };
      setInstall(() => () => prompt.prompt());
    };
    window.addEventListener('beforeinstallprompt', onInstall);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('beforeinstallprompt', onInstall);
      void lock?.release();
      hold(false);
    };
  }, []);

  useEffect(() => {
    if (attempt === 0) return;
    let dead = false;
    const room = new Room();
    roomRef.current = room;
    room.on(RoomEvent.DataReceived, (payload) => {
      const message = decodePhone(payload);
      if (message?.t === 'state') setState(message);
    });
    room.on(RoomEvent.Disconnected, () => { if (!dead && phaseRef.current === 'live') setStatus('Link closed'); });
    const run = async () => {
      try {
        const api = new Api(apiBase || API_URL, null);
        const redeemed = await api.phoneRedeem(code);
        if (dead) return;
        const who = [redeemed.communityName, redeemed.callsign].filter((part) => typeof part === 'string' && part).join(' · ');
        setStatus(who || 'Connected');
        await room.connect(resolveLivekitUrl(redeemed.livekitUrl, import.meta.env.VITE_LIVEKIT_URL), redeemed.token);
        if (dead) return;
        setPhase('live');
        setStatus(who || 'Connected');
      } catch (err) {
        if (dead) return;
        setPhase('error');
        setStatus(phoneRedeemError((err as Error).message));
      }
    };
    void run();
    return () => { dead = true; roomRef.current = null; hold(false); void room.disconnect(); };
  }, [attempt, code, apiBase]);

  const tx = state.channels.find((row) => row.id === state.tx);
  const holdButton = phoneHold(phase, state.on);
  const channelNote = phoneChannelNote(phase, state.channels.length);
  const expiry = phoneExpiryNote(expiresAt == null ? null : expiresAt - now, phase);
  const clock = expiresAt == null || phase === 'live' || phase === 'connecting' ? null : Math.max(0, expiresAt - now);

  return (
    <div className="phone-remote">
      <p className="notice">This phone keys the computer. It does not open a microphone here.</p>
      {clock != null && <p className="phone-clock">{formatCodeClock(clock)}</p>}
      {expiry && <p className="sub phone-status">{expiry}</p>}
      {(phase === 'idle' || phase === 'error') && (
        <button className="btn primary phone-connect" type="button" onClick={connect}>Connect</button>
      )}
      <div className="web-bar">
        <strong>{phase === 'live' ? (tx ? `${tx.freq} ${tx.name}` : 'No transmit channel') : 'Not connected yet'}</strong>
        <span className="sub">{status}</span>
        {install && <button className="btn sm" type="button" onClick={install}>Add to Home Screen</button>}
      </div>
      <ul className="simple-list">
        {phase === 'live' && state.channels.map((row) => (
          <li key={row.id} className={`simple-row ${row.id === state.tx ? 'tx' : ''}`}>
            <button className="simple-pick" type="button" onClick={() => {
              const room = roomRef.current;
              if (!room || room.state !== 'connected') return;
              void room.localParticipant.publishData(encodePhone({ t: 'tx', id: row.id }), { reliable: true, topic: 'rn' });
            }}>
              <span className="f">{row.freq}</span>
              <span className="n">{row.name}</span>
              {row.id === state.tx && <span className="txmark">TX</span>}
              <span className={`who ${row.who.length ? 'live' : ''}`}>{row.who.length ? row.who.join(', ') : ' '}</span>
            </button>
          </li>
        ))}
        {channelNote && <li className="sub">{channelNote}</li>}
      </ul>
      <button
        className={`ptt ${state.on && holdButton.enabled ? 'on' : ''}`}
        type="button"
        disabled={!holdButton.enabled}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (!holdButton.enabled) return;
          e.preventDefault();
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* iOS can reject capture */ }
          hold(true);
        }}
        onPointerUp={() => hold(false)}
        onPointerCancel={() => hold(false)}
        onLostPointerCapture={() => hold(false)}
      >
        {holdButton.label}
      </button>
      {!install && <p className="sub phone-install">Add to Home Screen from the browser menu to keep this page awake on the desk.</p>}
    </div>
  );
}
