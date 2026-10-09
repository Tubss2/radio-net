import { useEffect, useState } from 'react';
import type { OverlayState } from '../../shared/types';
import { bridge } from './bridge';
import { RadialWheel } from './RadialWheel';

export function Overlay({ talkersOnly = false }: { talkersOnly?: boolean }) {
  const [s, setS] = useState<OverlayState | null>(null);
  useEffect(() => bridge.onOverlay(setS), []);
  const showTalkers = Boolean(s?.visible && s.speakers.length > 0);
  const wheel = s?.wheel;
  if (!showTalkers && !wheel?.open) return null;
  return (
    <>
      {showTalkers && (
        <div className="overlay">
          <div className="ov">
            {s!.speakers.map((p, i) => (
              <div className="sp" key={`${p.name}\0${p.freq}\0${p.channel}\0${i}`}>
                <span className="dot" />
                <span>{p.name}</span>
                <span className="on">{p.freq} {p.channel}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {wheel?.open && !talkersOnly && (
        <RadialWheel
          segments={wheel.segments}
          adding={wheel.adding}
          addError={wheel.addError}
          available={wheel.available ?? []}
          canCreate={Boolean(wheel.canCreate)}
          onInput={(input) => bridge.sendWheelInput(input)}
          onPointer={(over) => bridge.setIgnoreMouse(!over)}
        />
      )}
    </>
  );
}
