import { UiohookKey, WheelDirection, uIOhook } from 'uiohook-napi';
import { shouldObserveInput } from '../shared/inputWatch';
import { cloneBinds, DEFAULT_BINDS } from '../shared/keybinds';
import { digitFromKeycode, hookShouldEmitScroll, scrollSteps } from '../shared/radialWheel';
import type { Bind, HotkeyEvent, Keybinds } from '../shared/types';
import { BIND_RECORD_MS } from '../shared/bindRecord';
import { clientLog } from './clientLog';

/**
 * Passive global keyboard/mouse hook (same technique as Discord/TeamSpeak PTT).
 * We only *observe* input; we never block it or send input to the game.
 * Caveat (Windows): if the game runs as administrator and we don't, Windows hides its input from us.
 */
export class Hotkeys {
  private binds: Keybinds = cloneBinds();
  private held = new Set<string>(); // de-dupe OS key-repeat
  private recording: ((b: Bind | null) => void) | null = null;
  private recordTimer: ReturnType<typeof setTimeout> | null = null;
  private wheelDownAt: number | null = null;
  /** Latched or held. Scroll keeps working after the wheel key (default F2) is released. */
  private wheelOpen = false;
  private running = false;
  private listenersOn = false;

  constructor(private emit: (e: HotkeyEvent) => void) {}

  start() {
    if (this.running) return;
    if (!this.listenersOn) {
      this.listenersOn = true;
      uIOhook.on('keydown', (e) => this.handle({ kind: 'key', keycode: e.keycode, label: keyLabel(e.keycode) }, true));
      uIOhook.on('keyup', (e) => this.handle({ kind: 'key', keycode: e.keycode, label: '' }, false));
      uIOhook.on('mousedown', (e) => this.handle({ kind: 'mouse', button: Number(e.button), label: `Mouse ${e.button}` }, true));
      uIOhook.on('mouseup', (e) => this.handle({ kind: 'mouse', button: Number(e.button), label: '' }, false));
      uIOhook.on('wheel', (e) => this.onWheel(e));
    }
    uIOhook.start();
    this.running = true;
    clientLog('hotkeys', 'start');
  }
  stop() {
    if (!this.running) return;
    uIOhook.stop();
    this.running = false;
    this.held.clear();
    this.wheelDownAt = null;
    clientLog('hotkeys', 'stop');
  }
  private onWheel(e: { direction: WheelDirection; rotation: number; shiftKey: boolean }) {
      // Observe-only. The game still sees the notch. index.ts drops a copy the overlay page
      // will already apply (foreground window, not click-through). Click-through does not
      // forward the wheel, and a latched wheel stays open after the wheel key is released, so this
      // runs the whole time the wheel is on screen — not only while F2 (the default) is held.
      if (e.direction !== WheelDirection.VERTICAL) return;
      if (!hookShouldEmitScroll({ wheelOpen: this.wheelOpen, wheelKeyHeld: this.wheelDownAt != null })) return;
      const steps = scrollSteps(e.rotation);
      if (steps) this.emit({ type: 'wheel-scroll', steps, shift: e.shiftKey });
  }
  setBinds(b: Keybinds) { this.binds = b; this.held.clear(); this.wheelDownAt = null; }
  setWheelOpen(open: boolean) { this.wheelOpen = open; }
  /**
   * Next key or mouse press becomes a bind. Left, right and middle click are ignored so the
   * click that opened the recorder does not bind itself. Escape cancels and resolves null.
   * A new call cancels the previous one. The wait ends on its own after BIND_RECORD_MS.
   */
  record(timeoutMs = BIND_RECORD_MS): Promise<Bind | null> {
    this.cancelRecord();
    return new Promise((resolve) => {
      const finish = (value: Bind | null) => {
        if (this.recording !== finish) return;
        this.recording = null;
        if (this.recordTimer) clearTimeout(this.recordTimer);
        this.recordTimer = null;
        resolve(value);
      };
      this.recording = finish;
      this.recordTimer = setTimeout(() => finish(null), timeoutMs);
    });
  }

  cancelRecord() {
    this.recording?.(null);
  }

  private handle(input: Bind, down: boolean) {
    const watch = shouldObserveInput(input, {
      binds: this.binds,
      recording: this.recording !== null,
      enabled: true,
      wheelOpen: this.wheelOpen,
      wheelKeyHeld: this.wheelDownAt != null,
    });
    if (!watch) return;
    const id = bindId(input);
    if (down && this.recording) {
      if (input.kind === 'key' && input.keycode === UiohookKey.Escape) {
        this.recording(null); return;
      }
      if (input.kind === 'mouse' && input.button <= 2) return;
      this.recording(input); return;
    }
    if (down) { if (this.held.has(id)) return; this.held.add(id); } else this.held.delete(id);
    const is = (b: Bind | null) => b !== null && bindId(b) === id;
    if (is(this.binds.ptt)) this.emit({ type: 'ptt', down });
    if (down && is(this.binds.prev)) this.emit({ type: 'cycle', step: -1 });
    if (down && is(this.binds.next)) this.emit({ type: 'cycle', step: 1 });
    if (down && is(this.binds.overlay)) this.emit({ type: 'overlay' });
    for (const [channelId, b] of Object.entries(this.binds.direct)) if (is(b)) this.emit({ type: 'direct', channelId, down });
    if (down) for (const [channelId, b] of Object.entries(this.binds.select ?? {})) if (is(b)) this.emit({ type: 'select', channelId });
    if (is(this.binds.wheel)) {
      if (down) { this.wheelDownAt = Date.now(); this.emit({ type: 'wheel', down: true, heldMs: 0 }); }
      else {
        const heldMs = this.wheelDownAt == null ? 0 : Date.now() - this.wheelDownAt;
        this.wheelDownAt = null;
        this.emit({ type: 'wheel', down: false, heldMs });
      }
    }
    if (down && input.kind === 'key' && input.keycode === UiohookKey.Escape && (this.wheelOpen || this.wheelDownAt != null)) {
      this.emit({ type: 'wheel-cancel' });
    }
    if (down && this.wheelDownAt != null && !is(this.binds.wheel) && input.kind === 'key') {
      const n = digitFromKeycode(input.keycode);
      if (n) this.emit({ type: 'wheel-number', n });
    }
  }
}

const bindId = (b: Bind) => (b.kind === 'key' ? `k${b.keycode}` : `m${b.button}`);
const names = Object.fromEntries(Object.entries(UiohookKey).map(([k, v]) => [v as number, k]));
const keyLabel = (code: number) => names[code] ?? `Key ${code}`;

export { DEFAULT_BINDS };
