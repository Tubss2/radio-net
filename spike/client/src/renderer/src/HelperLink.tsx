import { useEffect, useRef, useState } from 'react';
import {
  HELPER_DOWNLOAD_URL, HELPER_FALLBACK, HELPER_SOURCE_URL, HELPER_URL, forgetHelperDevice,
  helperForgetMessage, helperPairMessage, helperResumeMessage, helperWatchMessage, parseHelperEvent,
  readHelperDevice, writeHelperDevice, type HelperWatch, type StoredHelper,
} from '../../shared/helperLink';
import type { RadioControl } from './lib/radioEngine';

type Which = 'key' | '4' | '5';

function watchFor(which: Which, talkKey: string): HelperWatch {
  if (which === '4') return { kind: 'mouse', button: 4 };
  if (which === '5') return { kind: 'mouse', button: 5 };
  return { kind: 'key', code: talkKey };
}

function whichFrom(watch: HelperWatch | undefined): Which {
  if (watch?.kind === 'mouse') return watch.button === 5 ? '5' : '4';
  return 'key';
}

function storedDevice(): StoredHelper | null {
  try { return readHelperDevice((key) => localStorage.getItem(key)); } catch { return null; }
}

function remember(device: StoredHelper): void {
  try { writeHelperDevice((key, value) => localStorage.setItem(key, value), device); } catch { /* private mode */ }
}

function forgetStored(): void {
  try { forgetHelperDevice((key) => localStorage.removeItem(key)); } catch { /* private mode */ }
}

/** Link this browser to the Windows tray helper. Electron already has its own global key. */
export function HelperLink({ engine, externalDown, talkKey, talkLabel, showButton = true, opened = false, onOpenedChange, onLinked }: {
  engine: RadioControl;
  externalDown: { current: boolean };
  talkKey: string;
  talkLabel: string;
  showButton?: boolean;
  opened?: boolean;
  onOpenedChange?: (open: boolean) => void;
  onLinked?: (linked: boolean) => void;
}) {
  const saved = storedDevice();
  const [open, setOpen] = useState(false);
  const shown = open || opened;
  const [code, setCode] = useState('');
  const [which, setWhich] = useState<Which>(whichFrom(saved?.watch));
  const [linked, setLinked] = useState(false);
  const [holding, setHolding] = useState(false);
  const [error, setError] = useState('');
  const [remembered, setRemembered] = useState(Boolean(saved));
  const socket = useRef<WebSocket | null>(null);
  const held = useRef(false);
  const alive = useRef(true);
  const accepted = useRef(false);
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const whichRef = useRef(which);
  whichRef.current = which;
  const talkKeyRef = useRef(talkKey);
  talkKeyRef.current = talkKey;

  const release = () => {
    if (!held.current) return;
    held.current = false;
    externalDown.current = false;
    if (alive.current) setHolding(false);
    void engineRef.current.ptt(false);
  };

  const closeSocket = () => {
    const ws = socket.current;
    socket.current = null;
    if (ws && ws.readyState < WebSocket.CLOSING) ws.close();
  };

  const connect = (hello: string, opts: { resume: boolean; watch: HelperWatch }) => {
    setError('');
    accepted.current = false;
    if (!opts.resume) setLinked(false);
    release();
    closeSocket();
    let ws: WebSocket;
    try { ws = new WebSocket(HELPER_URL); } catch { if (!opts.resume) setError(HELPER_FALLBACK); return; }
    socket.current = ws;
    const timer = window.setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close();
        if (!opts.resume && alive.current) setError(HELPER_FALLBACK);
      }
    }, 1500);
    ws.onopen = () => { ws.send(hello); };
    ws.onmessage = (event) => {
      const message = parseHelperEvent(String(event.data));
      if (!message || !alive.current) return;
      if (message.t === 'ok') {
        window.clearTimeout(timer);
        accepted.current = true;
        if (message.token) {
          remember({ token: message.token, watch: opts.watch });
          setRemembered(true);
        }
        setLinked(true);
        setError('');
        if (opts.resume && ws.readyState === WebSocket.OPEN) ws.send(helperWatchMessage(opts.watch));
        return;
      }
      if (message.t === 'denied') {
        window.clearTimeout(timer);
        const dropStored = opts.resume || accepted.current;
        if (dropStored) { forgetStored(); setRemembered(false); }
        setLinked(false);
        if (!opts.resume && !accepted.current) setError('That pairing code was not accepted.');
        ws.close();
        return;
      }
      if (message.t === 'down') {
        if (held.current) return;
        held.current = true;
        externalDown.current = true;
        setHolding(true);
        void engineRef.current.unlock().then(() => engineRef.current.ptt(true));
        return;
      }
      if (message.t === 'up') release();
    };
    ws.onerror = () => { window.clearTimeout(timer); setLinked(false); if (!opts.resume) setError(HELPER_FALLBACK); };
    ws.onclose = () => {
      window.clearTimeout(timer);
      release();
      setLinked(false);
      if (socket.current === ws) socket.current = null;
    };
  };

  useEffect(() => { onLinked?.(linked); }, [linked, onLinked]);

  useEffect(() => {
    const device = storedDevice();
    if (device) connect(helperResumeMessage(device.token), { resume: true, watch: device.watch });
    return () => { alive.current = false; release(); closeSocket(); };
  }, []);

  useEffect(() => {
    if (!linked || which !== 'key') return;
    const watch = watchFor('key', talkKey);
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(helperWatchMessage(watch));
    const device = storedDevice();
    if (device) remember({ token: device.token, watch });
  }, [talkKey, linked, which]);

  const link = () => {
    const trimmed = code.trim();
    if (trimmed.length < 4) { setError('Type the pairing code from the tray.'); return; }
    const watch = watchFor(whichRef.current, talkKeyRef.current);
    connect(helperPairMessage(trimmed, watch), { resume: false, watch });
  };

  const choose = (next: Which) => {
    setWhich(next);
    const watch = watchFor(next, talkKeyRef.current);
    const device = storedDevice();
    if (device) remember({ token: device.token, watch });
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(helperWatchMessage(watch));
  };

  const dropRemote = (token: string) => {
    let drop: WebSocket;
    try { drop = new WebSocket(HELPER_URL); } catch { return; }
    const timer = window.setTimeout(() => {
      drop.close();
      if (alive.current) setError('This browser forgot the helper. If the tray icon is still linked, use Unlink this browser there.');
    }, 1500);
    drop.onopen = () => { drop.send(helperResumeMessage(token)); };
    drop.onmessage = (event) => {
      const message = parseHelperEvent(String(event.data));
      if (message?.t === 'ok') drop.send(helperForgetMessage());
      if (message?.t === 'ok' || message?.t === 'denied') {
        window.clearTimeout(timer);
        drop.close();
      }
    };
  };

  const unlink = () => {
    const device = storedDevice();
    const ws = socket.current;
    const open = Boolean(ws && ws.readyState === WebSocket.OPEN);
    if (open && ws) ws.send(helperForgetMessage());
    forgetStored();
    setRemembered(false);
    setLinked(false);
    setCode('');
    setError('');
    release();
    closeSocket();
    if (device && !open) dropRemote(device.token);
  };

  const close = () => { setOpen(false); onOpenedChange?.(false); };

  return (
    <>
      {showButton && <button className="btn sm" onClick={() => setOpen(true)}>{linked ? 'Helper linked' : 'Link helper'}</button>}
      {shown && (
        <div className="modal-bg" onClick={close}>
          <div className="modal phone-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>Windows helper</h3>
            <p className="sub" style={{ margin: 0 }}>
              {remembered
                ? 'This browser reconnects without the pairing code. Unlink on this page or in the tray menu to revoke it.'
                : 'Start RadioNetHelper.exe. Type the code from its tray balloon. It watches only the key you pick here, on this computer.'}
            </p>
            <p className="talk-links">
              <a href={HELPER_DOWNLOAD_URL}>Download RadioNetHelper.exe</a>
              <a href={HELPER_SOURCE_URL} target="_blank" rel="noreferrer">Open source on GitHub</a>
            </p>
            {!remembered && (
              <label className="helper-code-label">Pairing code
                <input className="helper-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" spellCheck={false} />
              </label>
            )}
            <label><input type="radio" name="helper-watch" checked={which === 'key'} onChange={() => choose('key')} /> Talk key ({talkLabel})</label>
            <label><input type="radio" name="helper-watch" checked={which === '4'} onChange={() => choose('4')} /> Mouse 4</label>
            <label><input type="radio" name="helper-watch" checked={which === '5'} onChange={() => choose('5')} /> Mouse 5</label>
            {linked && <p className="who live">{holding ? 'Holding. The mic is live.' : 'Helper linked. Hold the key.'}</p>}
            {error && <p className="err">{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {remembered && <button className="btn ghost" onClick={unlink}>Unlink</button>}
              <button className="btn ghost" onClick={close}>Close</button>
              {!remembered && <button className="btn primary" onClick={link}>Link</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
