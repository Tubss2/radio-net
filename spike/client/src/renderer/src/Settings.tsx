import { useState } from 'react';
import { cloneBinds, conflicts, DEFAULT_BINDS, pageKeybinds, setSlot } from '../../shared/keybinds';
import type { Bind, Keybinds } from '../../shared/types';
import { APP_VERSION } from '../../shared/version';
import { bridge, inElectron } from './bridge';
import { isPreview } from './lib/previewMode';
import type { SoundPrefs } from '../../shared/sounds';
import { SoundsSettings } from './SoundsSettings';

export interface BindRow { id: string; label: string }

const CORE: BindRow[] = [
  { id: 'ptt', label: 'Talk' },
  { id: 'overlay', label: 'Show or hide overlay' },
  { id: 'prev', label: 'Previous transmit channel' },
  { id: 'next', label: 'Next transmit channel' },
  { id: 'wheel', label: 'Channel wheel' },
  { id: 'allCall', label: 'All call' },
];

function current(binds: Keybinds, id: string): Bind | null {
  if (id === 'ptt' || id === 'prev' || id === 'next' || id === 'wheel' || id === 'overlay' || id === 'allCall') return binds[id];
  if (id.startsWith('select:')) return binds.select[id.slice('select:'.length)] ?? null;
  return null;
}

export function Settings({ binds, quick, hotkeysOn, onHotkeys, onPrivacy, sounds, onSounds, onChange, onClose }: {
  binds: Keybinds;
  quick: BindRow[];
  hotkeysOn: boolean;
  onHotkeys: (enabled: boolean) => void;
  onPrivacy: () => void;
  sounds: SoundPrefs;
  onSounds: (next: SoundPrefs) => void;
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
    if (!hotkeysOn) { setErr('Turn keybinds on before recording a key.'); return; }
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
        <div className="settings-head">
          <h3 style={{ margin: 0 }}>Keybinds</h3>
          <span className="about">Radio Net {APP_VERSION}</span>
        </div>
        <p className="sub" style={{ margin: 0 }}>
          Click a slot, then press a key. Left, right and middle click are left alone. Escape cancels. Only these binds are watched.
          {inElectron ? ' Defaults are F1 to talk (hold), F2 for the channel wheel, F3 and F4 for the previous and next transmit channel, and F5 to show or hide the overlay.' : ''}
          {' '}All call has no default key.
        </p>
        <label className="row">
          <input type="checkbox" checked={hotkeysOn} onChange={(e) => onHotkeys(e.target.checked)} />
          Listen for keybinds
        </label>
        <p className="sub" style={{ margin: 0 }}>
          Pausing removes the global keyboard and mouse hook. Other keys are never saved or sent.
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
        <SoundsSettings sounds={sounds} onSounds={onSounds} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" type="button" onClick={onPrivacy}>Privacy notes</button>
          <button className="btn ghost" onClick={() => onChange(inElectron ? cloneBinds(DEFAULT_BINDS) : pageKeybinds(null, isPreview))}>Reset to defaults</button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
