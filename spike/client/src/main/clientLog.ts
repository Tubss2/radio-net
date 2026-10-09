import { app } from 'electron';
import { appendClientLog } from '../shared/clientLog';

/** Append one line under userData/radio-net.log. Failures stay on the console. */
export function clientLog(event: string, detail?: string): void {
  try {
    appendClientLog(app.getPath('userData'), event, detail);
  } catch (err) {
    console.error('client log', err);
  }
}
