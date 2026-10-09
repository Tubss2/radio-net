import { useEffect, useRef, useState } from 'react';
import {
  VOLUME_MAX,
  WHEEL,
  digitFromCode,
  hitTest,
  polar,
  scrollSteps,
  segmentAngles,
  segmentPath,
  type WheelInput,
  type WheelSegmentView,
} from '../../shared/radialWheel';
import type { WheelChannelChoice } from '../../shared/types';

/**
 * The channel ring. Pointer math is the same hitTest the unit tests use.
 * Labels ignore the pointer so a click always lands on the segment underneath.
 */
export function RadialWheel({
  segments,
  adding,
  addError,
  available,
  canCreate,
  onInput,
  onPointer,
}: {
  segments: WheelSegmentView[];
  adding: boolean;
  addError: string;
  available: WheelChannelChoice[];
  canCreate: boolean;
  onInput: (input: WheelInput) => void;
  /** Overlay window: true while the pointer is over the ring or the add list, so clicks are captured. */
  onPointer?: (over: boolean) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const onPointerRef = useRef(onPointer);
  onPointerRef.current = onPointer;
  const countRef = useRef(segments.length);
  countRef.current = segments.length;
  const addingRef = useRef(adding);
  addingRef.current = adding;
  const hoverRef = useRef<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [freq, setFreq] = useState('');
  const [name, setName] = useState('');

  const indexAt = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = ((clientX - rect.left) / rect.width) * WHEEL.size;
    const y = ((clientY - rect.top) / rect.height) * WHEEL.size;
    return hitTest(x, y, WHEEL, countRef.current);
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const index = indexAt(e.clientX, e.clientY);
      const over = addingRef.current || index != null;
      onPointerRef.current?.(over);
      if (hoverRef.current !== index) {
        hoverRef.current = index;
        onInputRef.current({ type: 'hover', index });
      }
    };
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, []);

  useEffect(() => {
    if (adding) onPointerRef.current?.(true);
  }, [adding]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const index = indexAt(e.clientX, e.clientY);
      if (index == null) return;
      e.preventDefault();
      e.stopPropagation();
      const steps = scrollSteps(e.deltaY);
      if (steps) onInputRef.current({ type: 'scroll', index, steps, shift: e.shiftKey });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onInputRef.current({ type: 'close' });
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const n = digitFromCode(e.code);
      if (!n) return;
      e.preventDefault();
      onInputRef.current({ type: 'number', n });
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, []);

  useEffect(() => { if (adding) { setCreating(false); setFreq(''); setName(''); } }, [adding]);

  const angles = segmentAngles(segments.length);
  return (
    <div className="wheel-screen">
      <svg
        ref={svgRef}
        className="radial"
        viewBox={`0 0 ${WHEEL.size} ${WHEEL.size}`}
        onContextMenu={(e) => e.preventDefault()}
      >
        {segments.map((seg, i) => {
          const a = angles[i];
          const fill = seg.muted
            ? 'rgba(52,54,60,.78)'
            : seg.hovered
              ? 'rgba(78,88,108,.92)'
              : seg.transmitting
                ? 'rgba(92,70,32,.9)'
                : 'rgba(46,48,56,.88)';
          return (
            <path
              key={seg.kind + i}
              d={segmentPath(WHEEL.cx, WHEEL.cy, WHEEL.inner, WHEEL.outer, a.a0, a.a1)}
              fill={fill}
              style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              onClick={() => onInput({ type: 'left', index: i })}
              onContextMenu={(e) => { e.preventDefault(); onInput({ type: 'right', index: i }); }}
            />
          );
        })}
        <circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.outer} fill="none" stroke="rgba(255,255,255,.55)" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
        <circle cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.inner} fill="none" stroke="rgba(255,255,255,.55)" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
        {angles.map((a, i) => {
          const p0 = polar(WHEEL.cx, WHEEL.cy, WHEEL.inner, a.a0);
          const p1 = polar(WHEEL.cx, WHEEL.cy, WHEEL.outer, a.a0);
          return <line key={i} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="rgba(255,255,255,.9)" strokeWidth={2} style={{ pointerEvents: 'none' }} />;
        })}
        {segments.map((seg, i) => {
          const a = angles[i];
          const r = (WHEEL.inner + WHEEL.outer) / 2;
          const p = polar(WHEEL.cx, WHEEL.cy, r, a.mid);
          return (
            <g key={`l${i}`} transform={`translate(${p.x} ${p.y})`} style={{ pointerEvents: 'none' }}>
              <SegmentLabel seg={seg} />
            </g>
          );
        })}
      </svg>
      {adding && (
        <div className="radial-add">
          <div className="picks">
            {available.map((c) => (
              <button key={c.id} type="button" className="pick" onClick={() => onInput({ type: 'add-pick', channelId: c.id })}>
                <span className="f">{c.freq}</span>
                <span>{c.name}</span>
              </button>
            ))}
            {available.length === 0 && <div className="empty-add">Every channel is already tuned.</div>}
          </div>
          {canCreate && !creating && (
            <button type="button" className="link" onClick={() => setCreating(true)}>Enter frequency</button>
          )}
          {canCreate && creating && (
            <form className="create" onSubmit={(e) => { e.preventDefault(); onInput({ type: 'add-create', freq, name }); }}>
              <input aria-label="New frequency" placeholder="50.0" value={freq} onChange={(e) => setFreq(e.target.value)} autoFocus />
              <input aria-label="New name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <button type="submit" className="btn sm">Add</button>
            </form>
          )}
          {addError && <div className="err">{addError}</div>}
        </div>
      )}
    </div>
  );
}

function SegmentLabel({ seg }: { seg: WheelSegmentView }) {
  const ink = seg.muted ? '#8b939f' : seg.transmitting ? '#f0c14a' : '#f4f7fb';
  const dim = seg.muted ? '#6d7582' : 'rgba(232,235,241,.78)';
  if (seg.kind === 'add') {
    return (
      <>
        <RadioIcon />
        <text y={28} textAnchor="middle" fill={ink} fontSize={22} fontWeight={700}>+</text>
        <text y={46} textAnchor="middle" fill={dim} fontSize={11}>Add</text>
      </>
    );
  }
  const pct = Math.round(seg.volume * 100);
  const bar = 78 * Math.min(1, Math.max(0, seg.volume / VOLUME_MAX));
  return (
    <>
      {seg.transmitting && <SpeakerIcon x={-46} y={-14} color="#f0c14a" />}
      {seg.muted && <MuteIcon x={-46} y={-14} />}
      {seg.live && <circle cx={40} cy={-8} r={5} fill="#3ddc97" />}
      <text y={-2} textAnchor="middle" fill={ink} fontSize={18} fontWeight={700}>{seg.label}</text>
      <text y={18} textAnchor="middle" fill={ink} fontSize={13} fontFamily="ui-monospace, monospace">{seg.freq} MHz</text>
      <text y={36} textAnchor="middle" fill={seg.empty ? '#6d7582' : dim} fontSize={12}>{seg.empty ? 'no net' : seg.name}</text>
      {seg.showVolume && (
        <>
          <rect x={-39} y={46} width={78} height={5} rx={2.5} fill="rgba(255,255,255,.18)" />
          <rect x={-39} y={46} width={bar} height={5} rx={2.5} fill="#3ddc97" />
          <text y={66} textAnchor="middle" fill="#f4f7fb" fontSize={12}>{pct}%</text>
        </>
      )}
    </>
  );
}

function SpeakerIcon({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`} fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 6h3.2L9 2.2v11.6L4.2 10H1z" fill={color} stroke="none" />
      <path d="M12 4.2a5 5 0 0 1 0 7.6" />
      <path d="M14.2 2a8 8 0 0 1 0 12" />
    </g>
  );
}

function MuteIcon({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} fill="none" stroke="#8b939f" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 6h3.2L9 2.2v11.6L4.2 10H1z" fill="#8b939f" stroke="none" />
      <path d="M12 4.5l6 7M18 4.5l-6 7" />
    </g>
  );
}

function RadioIcon() {
  return (
    <g transform="translate(-9 -28)" fill="none" stroke="#9aa3b2" strokeWidth={1.6} strokeLinejoin="round">
      <path d="M6 2h6M9 2v3" />
      <rect x="3" y="5" width="12" height="14" rx="2" />
      <rect x="5.5" y="7.5" width="7" height="3.5" rx="0.6" fill="#9aa3b2" stroke="none" />
      <circle cx="9" cy="14.5" r="1.3" fill="#9aa3b2" stroke="none" />
    </g>
  );
}
