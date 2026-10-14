import { useSyncExternalStore } from 'react';
import { initialUpdateSession, reduceUpdateSession, type UpdateEvent, type UpdateSession } from '../../../shared/updates';
import { bridge } from '../bridge';

let session: UpdateSession = initialUpdateSession;
const listeners = new Set<() => void>();
let bound = false;

function dispatch(event: UpdateEvent) {
  session = reduceUpdateSession(session, event);
  listeners.forEach((fn) => fn());
}

function ensureBound() {
  if (bound) return;
  bound = true;
  bridge.onUpdateAvailable((info) => dispatch({ type: 'available', version: info.version }));
  bridge.onUpdateProgress((info) => dispatch({ type: 'progress', version: info.version, progress: info.progress }));
  bridge.onUpdateReady((info) => dispatch({ type: 'ready', version: info.version }));
  bridge.onUpdateError((info) => dispatch({ type: 'error', message: info.message }));
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useUpdateSession(): UpdateSession {
  ensureBound();
  return useSyncExternalStore(subscribe, () => session, () => session);
}

export function noteUpdateAvailable(version: string) {
  dispatch({ type: 'available', version });
}

export function requestUpdateDownload() {
  dispatch({ type: 'download' });
  bridge.downloadUpdate();
}

export function requestUpdateRetry() {
  const version = session.flow.phase === 'error' ? session.flow.version : null;
  dispatch({ type: 'retry' });
  if (version) bridge.downloadUpdate();
}

export function requestUpdateInstall() {
  dispatch({ type: 'install' });
  bridge.installUpdate();
}

export function dismissUpdateBanner() {
  dispatch({ type: 'later' });
}
