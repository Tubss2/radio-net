import { useEffect, useState } from 'react';
import type { OverlayState } from '../../shared/types';
import { bridge } from './bridge';

export function Overlay() {
  const [s, setS] = useState<OverlayState | null>(null);
  useEffect(() => bridge.onOverlay(setS), []);
  if (!s?.visible || s.speakers.length === 0) return null;
  return (
    <div className="overlay">
      <div className="ov">
        {s.speakers.map((p, i) => (
          <div className="sp" key={`${p.name}\0${p.freq}\0${p.channel}\0${i}`}>
            <span className="dot" />
            <span>{p.name}</span>
            <span className="on">{p.freq} {p.channel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
