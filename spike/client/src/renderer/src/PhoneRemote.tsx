import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import { API_URL, Api } from './lib/api';
import { resolveLivekitUrl } from './lib/livekitUrl';
import { decodePhone, encodePhone, type PhoneState } from '../../shared/phonePage';

/** The page a paired phone opens. It sends hold and channel changes. It does not publish a microphone. */
export function PhoneRemote({ code, apiBase }: { code: string; apiBase: string | null }) {
  const [status, setStatus] = useState('Joining…');
  const [state, setState] = useState<PhoneState>({ t: 'state', tx: null, channels: [], on: false });
  const [install, setInstall] = useState<(() => void) | null>(null);
  const roomRef = useRef<Room | null>(null);
  const held = useRef(false);
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);

  const send = (down: boolean) => {
    const room = roomRef.current;
    if (!room || room.state !== 'connected') return;
    void room.localParticipant.publishData(encodePhone({ t: 'ptt', down }), { reliable: true, topic: 'rn' });
  };

  const hold = (down: boolean) => {
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

  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const take = () => {
      void navigator.wakeLock?.request('screen').then((sentinel) => { lock = sentinel; }).catch(() => undefined);
    };
    take();
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
    let dead = false;
    const room = new Room();
    roomRef.current = room;
    room.on(RoomEvent.DataReceived, (payload) => {
      const message = decodePhone(payload);
      if (message?.t === 'state') setState(message);
    });
    room.on(RoomEvent.Disconnected, () => { if (!dead) setStatus('Link closed'); });
    const run = async () => {
      try {
        const api = new Api(apiBase || API_URL, null);
        const redeemed = await api.phoneRedeem(code);
        if (dead) return;
        setStatus(`${redeemed.callsign}`);
        await room.connect(resolveLivekitUrl(redeemed.livekitUrl, import.meta.env.VITE_LIVEKIT_URL), redeemed.token);
        if (dead) return;
        setStatus(redeemed.callsign);
      } catch (err) {
        if (!dead) setStatus((err as Error).message);
      }
    };
    void run();
    return () => { dead = true; roomRef.current = null; hold(false); void room.disconnect(); };
  }, [code, apiBase]);

  const tx = state.channels.find((row) => row.id === state.tx);
  return (
    <div className="phone-remote">
      <p className="notice">This phone keys the computer. It does not open the microphone here.</p>
      <div className="web-bar">
        <strong>{tx ? `${tx.freq} ${tx.name}` : 'No transmit channel'}</strong>
        <span className="sub">{status}</span>
        {install && <button className="btn sm" onClick={install}>Add to Home Screen</button>}
      </div>
      <ul className="simple-list">
        {state.channels.map((row) => (
          <li key={row.id} className={`simple-row ${row.id === state.tx ? 'tx' : ''}`}>
            <button className="simple-pick" onClick={() => {
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
        {state.channels.length === 0 && <li className="sub">Waiting for the computer’s radio.</li>}
      </ul>
      <button
        className={`ptt ${state.on ? 'on' : ''}`}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); hold(true); }}
        onPointerUp={() => hold(false)}
        onPointerCancel={() => hold(false)}
        onLostPointerCapture={() => hold(false)}
      >
        {state.on ? 'ON AIR' : 'Hold to talk'}
      </button>
      {!install && <p className="sub phone-install">Add to Home Screen from the browser menu to keep this page awake on the desk.</p>}
    </div>
  );
}
