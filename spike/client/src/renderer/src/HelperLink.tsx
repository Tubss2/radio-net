import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  HELPER_URL, forgetHelperDevice, helperCodeFromHash, helperForgetMessage, helperPairMessage,
  helperResumeMessage, isHelperCode, parseHelperEvent, readHelperDevice, writeHelperDevice, type StoredHelper,
} from '../../shared/helperLink';
import { helperSetupStatus, type HelperPhase } from '../../shared/pttChooser';
import type { RadioControl } from './lib/radioEngine';

function storedDevice(): StoredHelper | null {
  try { return readHelperDevice((key) => localStorage.getItem(key)); } catch { return null; }
}

function remember(device: StoredHelper): void {
  try { writeHelperDevice((key, value) => localStorage.setItem(key, value), device); } catch { /* private mode */ }
}

function forgetStored(): void {
  try { forgetHelperDevice((key) => localStorage.removeItem(key)); } catch { /* private mode */ }
}

/** Link this browser to the Windows helper window. The socket stays up when the setup dialog closes. */
export function HelperLink({ engine, externalDown, slot, onLinked }: {
  engine: RadioControl;
  externalDown: { current: boolean };
  slot: HTMLElement | null;
  onLinked?: (linked: boolean) => void;
}) {
  const saved = storedDevice();
  const [code, setCode] = useState(() => helperCodeFromHash(window.location.hash) ?? '');
  const [linked, setLinked] = useState(false);
  const [holding, setHolding] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<HelperPhase>(saved ? 'looking' : 'idle');
  const [remembered, setRemembered] = useState(Boolean(saved));
  const socket = useRef<WebSocket | null>(null);
  const held = useRef(false);
  const alive = useRef(true);
  const accepted = useRef(false);
  const sawLink = useRef(false);
  const prefilled = useRef(helperCodeFromHash(window.location.hash) != null);
  const autoSent = useRef(false);
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const codeRef = useRef(code);
  codeRef.current = code;

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

  const connect = (hello: string) => {
    setError('');
    setPhase('looking');
    accepted.current = false;
    release();
    closeSocket();
    let ws: WebSocket;
    try { ws = new WebSocket(HELPER_URL); } catch { setPhase('absent'); return; }
    socket.current = ws;
    const timer = window.setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close();
        if (alive.current) setPhase('absent');
      }
    }, 1500);
    ws.onopen = () => {
      window.clearTimeout(timer);
      if (alive.current) setPhase('found');
      ws.send(hello);
    };
    ws.onmessage = (event) => {
      const message = parseHelperEvent(String(event.data));
      if (!message || !alive.current) return;
      if (message.t === 'ok') {
        accepted.current = true;
        sawLink.current = true;
        if (message.token) {
          remember({ token: message.token });
          setRemembered(true);
        }
        setLinked(true);
        setPhase('connected');
        setError('');
        return;
      }
      if (message.t === 'denied') {
        const dropStored = Boolean(storedDevice()) && (hello.includes('"resume"') || accepted.current);
        if (dropStored) { forgetStored(); setRemembered(false); }
        setLinked(false);
        setPhase('found');
        if (!hello.includes('"resume"') && !accepted.current) setError('That pairing code was not accepted.');
        ws.close();
        return;
      }
      if (message.t === 'tx') {
        engineRef.current.cycle(message.dir === 'next' ? 1 : -1);
        return;
      }
      if (message.t === 'ptt' && message.down) {
        if (held.current) return;
        held.current = true;
        externalDown.current = true;
        setHolding(true);
        void engineRef.current.unlock().then(() => engineRef.current.ptt(true));
        return;
      }
      if (message.t === 'ptt') release();
    };
    ws.onerror = () => { window.clearTimeout(timer); if (!accepted.current && alive.current) setPhase('absent'); };
    ws.onclose = () => {
      window.clearTimeout(timer);
      release();
      const wasLinked = sawLink.current;
      setLinked(false);
      if (socket.current === ws) socket.current = null;
      if (!alive.current) return;
      if (wasLinked) {
        sawLink.current = false;
        setPhase('absent');
        setError('The helper window closed.');
      }
    };
  };

  useEffect(() => { onLinked?.(linked); }, [linked, onLinked]);

  useEffect(() => {
    if (!helperCodeFromHash(window.location.hash)) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  useEffect(() => {
    const device = storedDevice();
    if (device) connect(helperResumeMessage(device.token));
    return () => { alive.current = false; release(); closeSocket(); };
  }, []);

  useEffect(() => {
    if (!slot || linked || storedDevice() || socket.current) return;
    let cancelled = false;
    setPhase('looking');
    setError('');
    let ws: WebSocket;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      try { ws.close(); } catch { /* already closed */ }
      if (alive.current) setPhase('absent');
    }, 1500);
    try { ws = new WebSocket(HELPER_URL); } catch {
      window.clearTimeout(timer);
      setPhase('absent');
      return;
    }
    ws.onopen = () => {
      if (cancelled) { ws.close(); return; }
      cancelled = true;
      window.clearTimeout(timer);
      if (alive.current) setPhase('found');
      ws.close();
    };
    ws.onerror = () => {
      if (cancelled) return;
      cancelled = true;
      window.clearTimeout(timer);
      if (alive.current) setPhase('absent');
    };
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (ws.readyState < WebSocket.CLOSING) ws.close();
    };
  }, [slot, linked]);

  const link = () => {
    const trimmed = codeRef.current.trim().toUpperCase();
    if (!isHelperCode(trimmed)) { setError('Type the pairing code from the helper window.'); return; }
    connect(helperPairMessage(trimmed));
  };

  useEffect(() => {
    if (phase !== 'found' || !prefilled.current || autoSent.current) return;
    if (!isHelperCode(code)) return;
    autoSent.current = true;
    link();
  }, [phase, code]);

  const dropRemote = (token: string) => {
    let drop: WebSocket;
    try { drop = new WebSocket(HELPER_URL); } catch { return; }
    const timer = window.setTimeout(() => {
      drop.close();
      if (alive.current) setError('This browser forgot the helper. If the helper window is still open, use Unlink there.');
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
    setPhase('found');
    setCode('');
    setError('');
    sawLink.current = false;
    release();
    closeSocket();
    if (device && !open) dropRemote(device.token);
  };

  if (!slot) return null;
  const status = error || helperSetupStatus(phase, holding);
  return createPortal(
    <div className="helper-panel">
      {!remembered && (
        <label className="helper-code-label">Pairing code
          <input
            className="helper-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') link(); }}
            autoCapitalize="characters"
            spellCheck={false}
          />
        </label>
      )}
      <p className={phase === 'absent' && !holding ? 'err' : `helper-status${phase === 'connected' ? ' live' : ''}`}>{status}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        {remembered && <button className="btn ghost" type="button" onClick={unlink}>Unlink</button>}
        {!remembered && <button className="btn primary" type="button" onClick={link}>Link</button>}
      </div>
    </div>,
    slot,
  );
}
