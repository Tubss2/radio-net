import { useState } from 'react';
import { cloneBinds, conflicts, DEFAULT_BINDS, setSlot } from '../../shared/keybinds';
import type { Bind, Keybinds } from '../../shared/types';
import { bridge } from './bridge';

export interface BindRow { id: string; label: string }

const CORE: BindRow[] = [
  { id: 'ptt', label: 'Push-to-talk' },
  { id: 'wheel', label: 'Open channel wheel' },
  { id: 'overlay', label: 'Show or hide overlay' },
  { id: 'cycle', label: 'Cycle transmit channel' },
];

function current(binds: Keybinds, id: string): Bind | null {
  if (id === 'ptt' || id === 'wheel' || id === 'overlay' || id === 'cycle') return binds[id];
  if (id.startsWith('select:')) return binds.select[id.slice('select:'.length)] ?? null;
  return null;
}

export function Settings({ binds, quick, onChange, onClose }: {
  binds: Keybinds;
  quick: BindRow[];
  onChange: (next: Keybinds) => void;
  onClose: () => void;
}) {
  const [recording, setRecording] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const rows = [...CORE, ...quick];
  const names = Object.fromEntries(rows.map((r) => [r.id, r.label]));
  const clashes = conflicts(binds, names);

  const arm = async (id: string) => {
    setErr('');
    setRecording(id);
    try {
      const bind = await bridge.recordBind();
      if (bind) onChange(setSlot(binds, id, bind));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRecording(null);
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>Keybinds</h3>
        <p className="sub" style={{ margin: 0 }}>
          Click a slot, then press a key or a mouse button. Mouse 4 and Mouse 5 work. Left, right and middle click are left alone. Escape cancels.
        </p>
        <div className="binds">
          {rows.map((row) => {
            const bind = current(binds, row.id);
            const hot = recording === row.id;
            return (
              <div key={row.id} className={`bind ${hot ? 'hot' : ''}`}>
                <span>{row.label}</span>
                <button className="btn sm slot" onClick={() => void arm(row.id)}>{hot ? 'Press a key…' : (bind?.label ?? 'Unbound')}</button>
                <button className="btn sm ghost" onClick={() => onChange(setSlot(binds, row.id, null))} disabled={!bind}>Clear</button>
              </div>
            );
          })}
        </div>
        {quick.length === 0 && <div className="sub">Tune a channel to add a quick-select key for it.</div>}
        {clashes.map((c) => <div key={c} className="err">{c}</div>)}
        {err && <div className="err">{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={() => onChange(cloneBinds(DEFAULT_BINDS))}>Reset to defaults</button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
