import type { PointerEvent } from 'react';

/** Red cue for the admin who is broadcasting and for everyone who can hear it. */
export function AllCallBanner({ calling, from }: { calling: boolean; from: string | null }) {
  if (!calling && !from) return null;
  return (
    <div className="allcall-banner" role="status">
      <span className="kicker">ALL CALL</span>
      <span>{calling ? 'Every channel you are tuned to' : from}</span>
    </div>
  );
}

/** Hold control. Releasing the pointer, cancelling it, or losing capture all stop, and stop is safe to call twice. */
export function AllCallButton({ active, label, onDown, onUp }: {
  active: boolean;
  label: string;
  onDown: () => void;
  onUp: () => void;
}) {
  const stop = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onUp();
  };
  return (
    <button
      type="button"
      className={`btn sm allcall-btn${active ? ' on' : ''}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        onDown();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={() => onUp()}
    >
      {label}
    </button>
  );
}
