import type { RadioFilterPreset } from '../../shared/radioFilter';
import type { SoundPrefs } from '../../shared/sounds';
import { previewSound } from './lib/uiSounds';

/**
 * Shared sounds controls. Desktop Options and the web Settings dialog both use this panel.
 */
export function SoundsSettings({ sounds, onSounds }: {
  sounds: SoundPrefs;
  onSounds: (next: SoundPrefs) => void;
}) {
  return (
    <div className="sounds">
      <h3>Sounds</h3>
      <p className="sub" style={{ margin: 0 }}>Saved on this browser or this PC. The volume applies to every cue below.</p>
      <label className="row">Radio filter
        <RadioFilterSelect
          label="Radio filter"
          value={sounds.radioFilter}
          onChange={(radioFilter) => { if (radioFilter) onSounds({ ...sounds, radioFilter }); }}
        />
      </label>
      <p className="sub" style={{ margin: 0 }}>
        Colours voice you receive. Clean leaves it alone. A channel can use a different one.
        Digital runs Codec2 at 2400 bits per second in this browser and adds about 50 ms.
        Codec2 is LGPL-2.1 and stays a separate module.
        {' '}<a href="https://github.com/drowe67/codec2" target="_blank" rel="noreferrer">Source</a>
      </p>
      <div className="row">
        <label><input type="checkbox" checked={sounds.addChannel} onChange={(e) => onSounds({ ...sounds, addChannel: e.target.checked })} /> Add a channel</label>
        <button className="btn sm ghost" type="button" onClick={() => previewSound('add')}>Play</button>
      </div>
      <div className="row">
        <label><input type="checkbox" checked={sounds.ptt} onChange={(e) => onSounds({ ...sounds, ptt: e.target.checked })} /> Push-to-talk press and release</label>
        <button className="btn sm ghost" type="button" onClick={() => previewSound('ptt')}>Play</button>
      </div>
      <div className="row">
        <label><input type="checkbox" checked={sounds.txChange} onChange={(e) => onSounds({ ...sounds, txChange: e.target.checked })} /> Change transmit channel</label>
        <button className="btn sm ghost" type="button" onClick={() => previewSound('tx')}>Play</button>
      </div>
      <div className="row">
        <label><input type="checkbox" checked={sounds.roger} onChange={(e) => onSounds({ ...sounds, roger: e.target.checked })} /> Transmission beeps</label>
        <button className="btn sm ghost" type="button" onClick={() => previewSound('beeps')}>Play</button>
      </div>
      <p className="sub" style={{ margin: 0 }}>A short rising cue when someone else starts, and a falling cue when they let go. Played here, not mixed into the voice.</p>
      <div className="row">
        <label><input type="checkbox" checked={sounds.rogerLocal} onChange={(e) => onSounds({ ...sounds, rogerLocal: e.target.checked })} /> Hear your own</label>
      </div>
      <label className="row">Release delay
        <span className="sub">{sounds.hangMs} ms</span>
        <input type="range" min={0} max={400} step={10} value={sounds.hangMs} aria-label="Release delay" onChange={(e) => onSounds({ ...sounds, hangMs: Number(e.target.value) })} />
      </label>
      <p className="sub" style={{ margin: 0 }}>The mic stays open this long after you let go, so the end of a word is not cut off. The end cue follows it.</p>
      <label className="row">Volume
        <input type="range" min={0} max={100} value={Math.round(sounds.volume * 100)} aria-label="UI sound volume" onChange={(e) => onSounds({ ...sounds, volume: Number(e.target.value) / 100 })} />
      </label>
    </div>
  );
}

export function RadioFilterSelect({ value, allowDefault, label, onChange }: {
  value: RadioFilterPreset | null;
  allowDefault?: boolean;
  label: string;
  onChange: (preset: RadioFilterPreset | null) => void;
}) {
  return (
    <select
      className="radio-filter"
      aria-label={label}
      value={allowDefault ? (value ?? 'default') : (value ?? 'clean')}
      onChange={(e) => {
        const next = e.target.value;
        onChange(next === 'default' ? null : next as RadioFilterPreset);
      }}
    >
      {allowDefault && <option value="default">Default</option>}
      <option value="clean">Clean</option>
      <option value="handheld">Handheld</option>
      <option value="degraded">Degraded</option>
      <option value="digital">Digital</option>
    </select>
  );
}
