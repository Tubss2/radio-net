import { speakerKey, type SpeakerLine } from '../../shared/lastSpeaker';

/** Name and channel, with a thin bar that shrinks after the transmission ends. */
export function SpeakerChips({ lines }: { lines: readonly SpeakerLine[] }) {
  return (
    <span className="speaker-chips">
      {lines.map((line) => (
        <span
          key={speakerKey(line)}
          className={`speaker-chip ${line.live ? 'talking' : 'last'}`}
          style={{ opacity: line.opacity }}
        >
          <span>{line.name} · {line.freq} {line.channel}</span>
          {!line.live && <span className="fadebar" style={{ transform: `scaleX(${line.opacity})` }} />}
        </span>
      ))}
    </span>
  );
}
