import { useEffect, useRef, useState } from 'react';
import { HELPER_FALLBACK, HELPER_URL, helperPairMessage, parseHelperEvent, type HelperWatch } from '../../shared/helperLink';
import type { RadioControl } from './lib/radioEngine';

/** Link this browser to the Windows tray helper. Electron already has its own global key. */
export function HelperLink({ engine, externalDown, talkKey, talkLabel }: {
  engine: RadioControl;
  externalDown: { current: boolean };
  talkKey: string;
  talkLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [which, setWhich] = useState<'key' | '4' | '5'>('key');
  const [linked, setLinked] = useState(false);
  const [holding, setHolding] = useState(false);
  const [error, setError] = useState('');
  const socket = useRef<WebSocket | null>(null);
  const held = useRef(false);
  const alive = useRef(true);
  const engineRef = useRef(engine);
  engineRef.current = engine;

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

  useEffect(() => () => { alive.current = false; release(); closeSocket(); }, []);

  const link = () => {
    const trimmed = code.trim();
    if (trimmed.length < 4) { setError('Type the pairing code from the tray.'); return; }
    setError('');
    setLinked(false);
    release();
    closeSocket();
    const watch: HelperWatch = which === 'key'
      ? { kind: 'key', code: talkKey }
      : { kind: 'mouse', button: which === '4' ? 4 : 5 };
    let ws: WebSocket;
    try { ws = new WebSocket(HELPER_URL); } catch { setError(HELPER_FALLBACK); return; }
    socket.current = ws;
    const timer = window.setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close();
        setError(HELPER_FALLBACK);
      }
    }, 1500);
    ws.onopen = () => { ws.send(helperPairMessage(trimmed, watch)); };
    ws.onmessage = (event) => {
      const kind = parseHelperEvent(String(event.data));
      if (kind === 'ok') { window.clearTimeout(timer); setLinked(true); setError(''); return; }
      if (kind === 'down') {
        if (held.current) return;
        held.current = true;
        externalDown.current = true;
        setHolding(true);
        void engineRef.current.unlock().then(() => engineRef.current.ptt(true));
        return;
      }
      if (kind === 'up') release();
    };
    ws.onerror = () => { window.clearTimeout(timer); setLinked(false); setError(HELPER_FALLBACK); };
    ws.onclose = () => {
      window.clearTimeout(timer);
      release();
      setLinked(false);
      if (socket.current === ws) socket.current = null;
    };
  };

  const close = () => { setOpen(false); };

  return (
    <>
      <button className="btn sm" onClick={() => setOpen(true)}>Link helper</button>
      {open && (
        <div className="modal-bg" onClick={close}>
          <div className="modal phone-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>Link the Windows helper</h3>
            <p className="sub" style={{ margin: 0 }}>
              Start RadioNetHelper.exe. Type the code from its tray balloon. It watches only the key you pick here, on this computer.
            </p>
            <label className="helper-code-label">Pairing code
              <input className="helper-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" spellCheck={false} />
            </label>
            <label><input type="radio" name="helper-watch" checked={which === 'key'} onChange={() => setWhich('key')} /> Talk key ({talkLabel})</label>
            <label><input type="radio" name="helper-watch" checked={which === '4'} onChange={() => setWhich('4')} /> Mouse 4</label>
            <label><input type="radio" name="helper-watch" checked={which === '5'} onChange={() => setWhich('5')} /> Mouse 5</label>
            {linked && <p className="who live">{holding ? 'Holding. The mic is live.' : 'Helper linked. Hold the key.'}</p>}
            {error && <p className="err">{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={close}>Close</button>
              <button className="btn primary" onClick={link}>{linked ? 'Link again' : 'Link'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
