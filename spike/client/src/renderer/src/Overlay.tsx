import { useEffect, useState } from 'react';
import type { OverlayState } from '../../shared/types';
import { bridge } from './bridge';

export function Overlay() {
  const [s, setS] = useState<OverlayState | null>(null);
  useEffect(() => bridge.onOverlay(setS), []);
  if (!s?.visible) return null;
  return (
    <div className="overlay">
      <div className="ov">
        <div className={`tx ${s.transmitting ? 'keyed' : ''}`}>
          {s.transmitting ? <span className="onair">TX</span> : <span style={{ color: 'var(--muted)', fontSize: 11, letterSpacing: '.1em' }}>TX</span>}
          <span className="f">{s.txFreq ?? '—'}</span><span>{s.txName}</span>
        </div>
        {s.speakers.slice(0, 5).map((p) => (
          <div className="sp" key={p.name + p.freq}><span className="dot" />{p.name}<span className="on">{p.freq}</span></div>
        ))}
      </div>
    </div>
  );
}
