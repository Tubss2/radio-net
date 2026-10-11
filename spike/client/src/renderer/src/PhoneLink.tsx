import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Room, RoomEvent } from 'livekit-client';
import { decodePhone, encodePhone, formatCodeClock, PHONE_SYNC_ID, phoneHostStatus, phonePageUrl, type PhoneState } from '../../shared/phonePage';
import type { TalkHolds } from '../../shared/talkHolds';
import type { Api } from './lib/api';
import { resolveLivekitUrl } from './lib/livekitUrl';
import type { RadioControl } from './lib/radioEngine';

/** QR for a one-time phone link. The phone keys the mic that is already published on this computer. */
export function PhoneLink({ api, cid, apiBase, electron, engine, holds, showButton = true, opened = false, onOpenedChange, onLinked, onDisconnectReady }: {
  api: Api;
  cid: string;
  apiBase: string;
  electron: boolean;
  engine: RadioControl;
  holds: TalkHolds;
  showButton?: boolean;
  opened?: boolean;
  onOpenedChange?: (open: boolean) => void;
  onLinked?: (linked: boolean) => void;
  /** The main radio calls this to end the link without opening the dialog. */
  onDisconnectReady?: (disconnect: (() => void) | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = open || opened;
  const [hosting, setHosting] = useState(false);
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
  const linkedRef = useRef(false);
  linkedRef.current = linked;
  const shownRef = useRef(false);
  shownRef.current = shown;
  const urlRef = useRef('');
  const onOpenedChangeRef = useRef(onOpenedChange);
  onOpenedChangeRef.current = onOpenedChange;

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

  const holdsRef = useRef(holds);
  holdsRef.current = holds;

  const releaseHold = () => {
    if (!held.current) return;
    held.current = false;
    holdsRef.current.up('phone');
    publish();
  };

  useEffect(() => {
    onLinked?.(linked);
  }, [linked, onLinked]);

  const endHost = (keepDialog: boolean) => {
    releaseHold();
    setLinked(false);
    setHosting(false);
    if (!keepDialog) {
      setOpen(false);
      onOpenedChangeRef.current?.(false);
      urlRef.current = '';
      setUrl('');
      setSvg('');
      setExpiresAt(null);
    }
  };
  const endHostRef = useRef(endHost);
  endHostRef.current = endHost;

  useEffect(() => {
    onDisconnectReady?.(() => endHostRef.current(false));
    return () => onDisconnectReady?.(null);
  }, [onDisconnectReady]);

  useEffect(() => {
    if (!hosting) return;
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
          holdsRef.current.down('phone');
        }
        publish();
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
      if (dead || participant.identity !== phoneId.current) return;
      endHostRef.current(shownRef.current);
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
      held.current = false;
      holdsRef.current.drop('phone');
      roomRef.current = null;
      void room.disconnect();
    };
  }, [hosting, api, cid]);

  useEffect(() => { if (hosting) publish(); }, [hosting, engine.version]);

  useEffect(() => {
    if (!shown || linked || expiresAt == null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [shown, linked, expiresAt]);

  useEffect(() => {
    if (!hosting || linked || expiresAt == null) return;
    const delay = Math.max(0, expiresAt - Date.now());
    const id = window.setTimeout(() => {
      if (linkedRef.current) return;
      endHostRef.current(shownRef.current);
    }, delay);
    return () => window.clearTimeout(id);
  }, [hosting, linked, expiresAt]);

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
      urlRef.current = page;
      setUrl(page);
      setSvg(await QRCode.toString(page, { type: 'svg', margin: 1, width: 220, color: { dark: '#e8ebf1', light: '#14171d' } }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    if (!shown) return;
    setHosting(true);
    if (!linkedRef.current && !urlRef.current) void showCode();
  }, [shown]);

  const close = () => {
    setOpen(false);
    onOpenedChange?.(false);
  };

  const disconnect = () => endHost(false);

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
      {showButton && (
        <span className="phone-chip">
          <button className="btn sm" type="button" onClick={() => setOpen(true)}>{linked ? 'Phone linked' : 'Use phone'}</button>
          {linked && <button className="btn sm ghost" type="button" onClick={disconnect}>Disconnect</button>}
        </span>
      )}
      {shown && (
        <div className="modal-bg" onClick={close}>
          <div className="modal phone-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>Use phone as push-to-talk</h3>
            <p className="sub" style={{ margin: 0 }}>The phone only keys this visit. It does not get your admin key. Closing this window keeps the button.</p>
            <p className={linked ? 'who live' : 'phone-status'} style={{ margin: 0 }}>{status}</p>
            {remaining != null && !linked && <p className="phone-clock">{formatCodeClock(remaining)}</p>}
            {svg ? <div className={`qr${expired ? ' expired' : ''}`} dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="sub">Making a code…</p>}
            {url && <a href={url} target="_blank" rel="noreferrer">Open the phone page</a>}
            {voice === 'down' && <p className="err">The voice server did not accept the link yet. The code is ready. Push-to-talk starts when that server is reachable.</p>}
            {voice === 'connecting' && <p className="sub">Connecting this computer…</p>}
            {error && <p className="err">{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {!linked && <button className={expired ? 'btn primary' : 'btn ghost'} type="button" onClick={() => { setHosting(true); void showCode(); }}>New code</button>}
              {hosting && <button className="btn ghost" type="button" onClick={disconnect}>Disconnect</button>}
              <button className={expired || linked ? 'btn ghost' : 'btn primary'} type="button" onClick={close}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
