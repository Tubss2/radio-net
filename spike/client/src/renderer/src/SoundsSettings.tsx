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
      <label className="row">Volume
        <input type="range" min={0} max={100} value={Math.round(sounds.volume * 100)} aria-label="UI sound volume" onChange={(e) => onSounds({ ...sounds, volume: Number(e.target.value) / 100 })} />
      </label>
    </div>
  );
}
