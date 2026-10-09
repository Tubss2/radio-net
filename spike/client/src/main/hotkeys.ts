import { UiohookKey, uIOhook } from 'uiohook-napi';
import type { Bind, HotkeyEvent, Keybinds } from '../shared/types';

/**
 * Passive global keyboard/mouse hook (same technique as Discord/TeamSpeak PTT).
 * We only *observe* input; we never block it or send input to the game.
 * Caveat (Windows): if the game runs as administrator and we don't, Windows hides its input from us.
 */
export class Hotkeys {
  private binds: Keybinds = { ptt: null, cycle: null, overlay: null, direct: {} };
  private held = new Set<string>(); // de-dupe OS key-repeat
  private recording: ((b: Bind) => void) | null = null;

  constructor(private emit: (e: HotkeyEvent) => void) {}

  start() {
    uIOhook.on('keydown', (e) => this.handle({ kind: 'key', keycode: e.keycode, label: keyLabel(e.keycode) }, true));
    uIOhook.on('keyup', (e) => this.handle({ kind: 'key', keycode: e.keycode, label: '' }, false));
    uIOhook.on('mousedown', (e) => this.handle({ kind: 'mouse', button: Number(e.button), label: `Mouse ${e.button}` }, true));
    uIOhook.on('mouseup', (e) => this.handle({ kind: 'mouse', button: Number(e.button), label: '' }, false));
    uIOhook.start();
  }
  stop() { uIOhook.stop(); }
  setBinds(b: Keybinds) { this.binds = b; this.held.clear(); }
  /** Next key/mouse press is captured as a bind (keybind recorder UI). Left/right click are ignored. */
  record(): Promise<Bind> {
    return new Promise((resolve) => { this.recording = resolve; });
  }

  private handle(input: Bind, down: boolean) {
    const id = bindId(input);
    if (down && this.recording) {
      if (input.kind === 'mouse' && input.button <= 2) return;
      const r = this.recording; this.recording = null; r(input); return;
    }
    if (down) { if (this.held.has(id)) return; this.held.add(id); } else this.held.delete(id);
    const is = (b: Bind | null) => b !== null && bindId(b) === id;
    if (is(this.binds.ptt)) this.emit({ type: 'ptt', down });
    if (down && is(this.binds.cycle)) this.emit({ type: 'cycle' });
    if (down && is(this.binds.overlay)) this.emit({ type: 'overlay' });
    for (const [channelId, b] of Object.entries(this.binds.direct)) if (is(b)) this.emit({ type: 'direct', channelId, down });
  }
}

const bindId = (b: Bind) => (b.kind === 'key' ? `k${b.keycode}` : `m${b.button}`);
const names = Object.fromEntries(Object.entries(UiohookKey).map(([k, v]) => [v as number, k]));
const keyLabel = (code: number) => names[code] ?? `Key ${code}`;

export const DEFAULT_BINDS: Keybinds = {
  ptt: { kind: 'mouse', button: 4, label: 'Mouse 4' },
  cycle: { kind: 'mouse', button: 5, label: 'Mouse 5' },
  overlay: { kind: 'key', keycode: UiohookKey.F10, label: 'F10' },
  direct: {},
};
