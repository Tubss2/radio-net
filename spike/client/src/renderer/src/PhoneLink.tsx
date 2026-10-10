import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Room, RoomEvent } from 'livekit-client';
import { decodePhone, encodePhone, formatCodeClock, PHONE_SYNC_ID, phoneHostStatus, phonePageUrl, type PhoneState } from '../../shared/phonePage';
import type { Api } from './lib/api';
import { resolveLivekitUrl } from './lib/livekitUrl';
import type { RadioControl } from './lib/radioEngine';

/** QR for a one-time phone link. The phone keys the mic that is already published on this computer. */
export function PhoneLink({ api, cid, apiBase, electron, engine, externalDown, showButton = true, opened = false, onOpenedChange, onLinked }: {
  api: Api;
  cid: string;
  apiBase: string;
  electron: boolean;
  engine: RadioControl;
  externalDown: { current: boolean };
  showButton?: boolean;
  opened?: boolean;
  onOpenedChange?: (open: boolean) => void;
  onLinked?: (linked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = open || opened;
  const [linked, setLinked] = useState(false);
  const [url, setUrl] = useState('');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [voice, setVoice] = useState<'connecting' | 'ready' | 'down'>('connecting');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const roomRef = useRef<Room | null>(null);
  const phoneId = useRef('');
  const held = useRef(false);
  const lastDown = useRef(0);
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const snapshot = (): PhoneState => {
    const radio = engineRef.current;
    radio.ensureTx();
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
    void engineRef.current.ptt(false).finally(() => publish());
  };

  useEffect(() => {
    onLinked?.(linked);
  }, [linked, onLinked]);

  useEffect(() => {
    if (!shown) return;
    let dead = false;
    const room = new Room();
    roomRef.current = room;
    const onData = (payload: Uint8Array, participant?: { identity: string }) => {
      if (!participant || participant.identity !== phoneId.current) return;
      const message = decodePhone(payload);
      if (!message || message.t === 'state') return;
      setLinked(true);
      if (message.t === 'tx') {
        // rn-sync is the phone asking for this snapshot. It is not a channel change.
        if (message.id !== PHONE_SYNC_ID) engineRef.current.setTx(message.id);
        publish();
        return;
      }
      if (message.down) {
        lastDown.current = Date.now();
        if (!held.current) {
          held.current = true;
          externalDown.current = true;
          void engineRef.current.unlock()
            .then(() => engineRef.current.ptt(true))
            .finally(() => publish());
        } else publish();
        return;
      }
      if (held.current) releaseHold();
      else publish();
    };
    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (participant.identity !== phoneId.current) return;
      setLinked(true);
      // Data messages are not stored. A channel tuned before the phone arrived has to be sent again.
      publish();
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
    // The phone may join, or a channel may be tuned, between the one-off events.
    const pulse = setInterval(() => publish(), 1000);
    return () => {
      dead = true;
      clearInterval(watch);
      clearInterval(pulse);
      releaseHold();
      roomRef.current = null;
      void room.disconnect();
    };
  }, [shown, api, cid]);

  useEffect(() => { if (shown) publish(); }, [shown, engine.version]);

  useEffect(() => {
    if (!shown || linked || expiresAt == null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [shown, linked, expiresAt]);

  const showCode = async () => {
    setError('');
    try {
      const paired = await api.phonePair(cid);
      const page = phonePageUrl({
        code: paired.code, apiBase, electron, origin: location.origin, base: import.meta.env.BASE_URL,
        expiresAt: paired.expiresAt,
      });
      const exp = Date.parse(paired.expiresAt);
      setExpiresAt(Number.isFinite(exp) ? exp : null);
      setNow(Date.now());
      setUrl(page);
      setSvg(await QRCode.toString(page, { type: 'svg', margin: 1, width: 220, color: { dark: '#e8ebf1', light: '#14171d' } }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => { if (shown) void showCode(); }, [shown]);

  const close = () => {
    setOpen(false);
    onOpenedChange?.(false);
    setLinked(false);
    setExpiresAt(null);
    setUrl('');
    setSvg('');
  };

  const remaining = expiresAt == null ? null : expiresAt - now;
  const expired = remaining != null && remaining <= 0 && !linked;
  const status = phoneHostStatus({
    linked,
    makingCode: shown && !svg && !error,
    remainingMs: remaining,
    tuned: engine.tuned.length > 0,
  });

  return (
    <>
      {showButton && <button className="btn sm" onClick={() => setOpen(true)}>Use phone</button>}
      {shown && (
        <div className="modal-bg" onClick={close}>
          <div className="modal phone-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>Use phone as push-to-talk</h3>
            <p className="sub" style={{ margin: 0 }}>The phone only keys this visit. It does not get your admin key.</p>
            <p className={linked ? 'who live' : 'phone-status'} style={{ margin: 0 }}>{status}</p>
            {remaining != null && !linked && <p className="phone-clock">{formatCodeClock(remaining)}</p>}
            {svg ? <div className={`qr${expired ? ' expired' : ''}`} dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="sub">Making a code…</p>}
            {url && <a href={url} target="_blank" rel="noreferrer">Open the phone page</a>}
            {voice === 'down' && <p className="err">The voice server did not accept the link yet. The code is ready. Push-to-talk starts when that server is reachable.</p>}
            {voice === 'connecting' && <p className="sub">Connecting this computer…</p>}
            {error && <p className="err">{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className={expired ? 'btn primary' : 'btn ghost'} type="button" onClick={() => void showCode()}>New code</button>
              <button className={expired ? 'btn ghost' : 'btn primary'} type="button" onClick={close}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
