import type { HotkeyEvent, OverlayState, UpdateReady, WheelInput } from '../../../shared/types';
import type { UpdateProgress } from '../../../shared/updates';

type Fn<T> = (value: T) => void;

const hotkeys = new Set<Fn<HotkeyEvent>>();
const overlays = new Set<Fn<OverlayState>>();
const wheels = new Set<Fn<WheelInput>>();
const updates = new Set<Fn<UpdateReady>>();
const updateAvailable = new Set<Fn<UpdateReady>>();
const updateProgress = new Set<Fn<{ version: string; progress: UpdateProgress | null }>>();
const updateErrors = new Set<Fn<{ message: string }>>();
let lastOverlay: OverlayState | null = null;
let previewVersion = '9.9.9';
let previewTimer: ReturnType<typeof setInterval> | null = null;

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

function stopPreviewDownload() {
  if (previewTimer) clearInterval(previewTimer);
  previewTimer = null;
}

export function emitPreviewUpdateAvailable(info: UpdateReady) {
  previewVersion = info.version;
  updateAvailable.forEach((fn) => fn(info));
}
export function onPreviewUpdateAvailable(fn: Fn<UpdateReady>) {
  updateAvailable.add(fn);
  return () => { updateAvailable.delete(fn); };
}

export function emitPreviewUpdateProgress(info: { version: string; progress: UpdateProgress | null }) {
  updateProgress.forEach((fn) => fn(info));
}
export function onPreviewUpdateProgress(fn: Fn<{ version: string; progress: UpdateProgress | null }>) {
  updateProgress.add(fn);
  return () => { updateProgress.delete(fn); };
}

export function emitPreviewUpdateError(info: { message: string }) {
  stopPreviewDownload();
  updateErrors.forEach((fn) => fn(info));
}
export function onPreviewUpdateError(fn: Fn<{ message: string }>) {
  updateErrors.add(fn);
  return () => { updateErrors.delete(fn); };
}

export function emitPreviewUpdate(info: UpdateReady) {
  stopPreviewDownload();
  previewVersion = info.version;
  updates.forEach((fn) => fn(info));
}
export function onPreviewUpdate(fn: Fn<UpdateReady>) {
  updates.add(fn);
  return () => { updates.delete(fn); };
}

/** Pretend the installer is downloading so the preview can show the progress bar. */
export function startPreviewDownload() {
  stopPreviewDownload();
  const total = 48 * 1024 * 1024;
  const bytesPerSecond = 2.4 * 1024 * 1024;
  let step = 0;
  emitPreviewUpdateProgress({ version: previewVersion, progress: null });
  previewTimer = setInterval(() => {
    step += 1;
    const percent = step * 25;
    if (percent >= 100) {
      stopPreviewDownload();
      emitPreviewUpdate({ version: previewVersion });
      return;
    }
    emitPreviewUpdateProgress({
      version: previewVersion,
      progress: { percent, transferred: Math.round(total * percent / 100), total, bytesPerSecond },
    });
  }, 800);
}
