import type { HotkeyEvent, OverlayState, UpdateReady, WheelInput } from '../../../shared/types';

type Fn<T> = (value: T) => void;

const hotkeys = new Set<Fn<HotkeyEvent>>();
const overlays = new Set<Fn<OverlayState>>();
const wheels = new Set<Fn<WheelInput>>();
const updates = new Set<Fn<UpdateReady>>();
let lastOverlay: OverlayState | null = null;

export function emitPreviewHotkey(event: HotkeyEvent) {
  hotkeys.forEach((fn) => fn(event));
}
export function onPreviewHotkey(fn: Fn<HotkeyEvent>) {
  hotkeys.add(fn);
  return () => { hotkeys.delete(fn); };
}

export function publishOverlay(state: OverlayState) {
  lastOverlay = state;
  overlays.forEach((fn) => fn(state));
}
export function onPreviewOverlay(fn: Fn<OverlayState>) {
  overlays.add(fn);
  if (lastOverlay) fn(lastOverlay);
  return () => { overlays.delete(fn); };
}

export function emitPreviewWheel(input: WheelInput) {
  wheels.forEach((fn) => fn(input));
}
export function onPreviewWheel(fn: Fn<WheelInput>) {
  wheels.add(fn);
  return () => { wheels.delete(fn); };
}

export function emitPreviewUpdate(info: UpdateReady) {
  updates.forEach((fn) => fn(info));
}
export function onPreviewUpdate(fn: Fn<UpdateReady>) {
  updates.add(fn);
  return () => { updates.delete(fn); };
}
