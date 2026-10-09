import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Room, RoomEvent } from 'livekit-client';
import { decodePhone, encodePhone, phonePageUrl, type PhoneState } from '../../shared/phonePage';
import type { Api } from './lib/api';
import { resolveLivekitUrl } from './lib/livekitUrl';
import type { RadioControl } from './lib/radioEngine';

/** QR for a one-time phone link. The phone keys the mic that is already published on this computer. */
export function PhoneLink({ api, cid, apiBase, electron, engine, externalDown }: {
  api: Api;
  cid: string;
  apiBase: string;
  electron: boolean;
  engine: RadioControl;
  externalDown: { current: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [linked, setLinked] = useState(false);
  const [url, setUrl] = useState('');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [voice, setVoice] = useState<'connecting' | 'ready' | 'down'>('connecting');
  const roomRef = useRef<Room | null>(null);
  const phoneId = useRef('');
  const held = useRef(false);
  const lastDown = useRef(0);
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const snapshot = (): PhoneState => {
    const radio = engineRef.current;
    return {
      t: 'state',
      tx: radio.txId,
      on: Boolean(radio.transmittingOn),
      channels: radio.tuned.map((row) => ({
        id: row.channel.id, freq: row.channel.freq, name: row.channel.name, who: row.speakers,
      })),
    };
  };

  const publish = () => {
    const room = roomRef.current;
    if (!room || room.state !== 'connected') return;
    void room.localParticipant.publishData(encodePhone(snapshot()), { reliable: true, topic: 'rn' });
  };

  const releaseHold = () => {
    if (!held.current) return;
    held.current = false;
    externalDown.current = false;
    void engineRef.current.ptt(false);
    publish();
  };

  useEffect(() => {
    if (!open) return;
    let dead = false;
    const room = new Room();
    roomRef.current = room;
    const onData = (payload: Uint8Array, participant?: { identity: string }) => {
      if (!participant || participant.identity !== phoneId.current) return;
      const message = decodePhone(payload);
      if (!message || message.t === 'state') return;
      if (message.t === 'tx') { engineRef.current.setTx(message.id); publish(); return; }
      if (message.down) {
        lastDown.current = Date.now();
        if (!held.current) {
          held.current = true;
          externalDown.current = true;
          void engineRef.current.unlock().then(() => engineRef.current.ptt(true));
        }
      } else releaseHold();
      publish();
    };
    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (participant.identity === phoneId.current) setLinked(true);
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (participant.identity !== phoneId.current) return;
      setLinked(false);
      releaseHold();
    });
    const start = async () => {
      try {
        const host = await api.phoneHost(cid);
        if (dead) return;
        phoneId.current = host.phoneIdentity;
        await room.connect(resolveLivekitUrl(host.livekitUrl, import.meta.env.VITE_LIVEKIT_URL), host.token);
        if (dead) return;
        setVoice('ready');
        publish();
      } catch {
        if (!dead) setVoice('down');
      }
    };
    void start();
    const watch = setInterval(() => {
      if (held.current && Date.now() - lastDown.current > 1500) releaseHold();
    }, 300);
    return () => {
      dead = true;
      clearInterval(watch);
      releaseHold();
      roomRef.current = null;
      void room.disconnect();
    };
  }, [open, api, cid]);

  useEffect(() => { if (open) publish(); }, [open, engine.version]);

  const showCode = async () => {
    setError('');
    try {
      const paired = await api.phonePair(cid);
      const page = phonePageUrl({
        code: paired.code, apiBase, electron, origin: location.origin, base: import.meta.env.BASE_URL,
      });
      setUrl(page);
      setSvg(await QRCode.toString(page, { type: 'svg', margin: 1, width: 220, color: { dark: '#e8ebf1', light: '#14171d' } }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => { if (open) void showCode(); }, [open]);

  const close = () => { setOpen(false); setLinked(false); setUrl(''); setSvg(''); };

  return (
    <>
      <button className="btn sm" onClick={() => setOpen(true)}>Use phone</button>
      {open && (
        <div className="modal-bg" onClick={close}>
          <div className="modal phone-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>Use phone as push-to-talk</h3>
            <p className="sub" style={{ margin: 0 }}>
              Scan this with the phone. The code works once and expires in two minutes. The phone only keys this visit. It does not get your admin key.
            </p>
            {svg ? <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="sub">Making a code…</p>}
            {linked ? <p className="who live">Phone linked. Hold the button on the phone.</p> : <p className="sub">Waiting for the phone.</p>}
            {voice === 'down' && <p className="err">The voice server did not accept the link yet. The code is ready; push-to-talk starts when that server is reachable.</p>}
            {voice === 'connecting' && <p className="sub">Connecting the voice link…</p>}
            {error && <p className="err">{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => void showCode()}>New code</button>
              <button className="btn primary" onClick={close}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
