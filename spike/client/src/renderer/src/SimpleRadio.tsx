import type { RadioControl } from './lib/radioEngine';

export function SimpleRadio({ engine, onDown, onUp, label }: {
  engine: RadioControl;
  onDown: () => void;
  onUp: () => void;
  label: string;
}) {
  const keyed = Boolean(engine.transmittingOn);
  return (
    <div className="simple">
      <ul className="simple-list">
        {engine.tuned.map((t) => {
          const tx = engine.txId === t.channel.id;
          const talking = t.speakers.length > 0;
          return (
            <li key={t.channel.id} className={`simple-row ${tx ? 'tx' : ''}`}>
              <button className="simple-pick" onClick={() => engine.setTx(t.channel.id)} disabled={!t.canTransmit}>
                <span className="f">{t.channel.freq}</span>
                <span className="n">{t.channel.name}</span>
                {tx && <span className="txmark">TX</span>}
                <span className={`who ${talking ? 'live' : ''}`}>{talking ? t.speakers.join(', ') : ' '}</span>
              </button>
              <button className="btn sm ghost" onClick={() => engine.setMuted(t.channel.id, !t.muted)}>{t.muted ? 'Unmute' : 'Mute'}</button>
              <input aria-label={`${t.channel.name} volume`} type="range" min={0} max={1.5} step={0.05} value={t.muted ? 0 : t.volume} onChange={(e) => engine.setVolume(t.channel.id, Number(e.target.value))} />
            </li>
          );
        })}
        {engine.tuned.length === 0 && <li className="sub">Tune a channel to hear it here.</li>}
      </ul>
      <button
        className={`ptt ${keyed ? 'on' : ''}`}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onDown(); }}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onLostPointerCapture={onUp}
      >
        {keyed ? 'ON AIR' : label}
      </button>
    </div>
  );
}
