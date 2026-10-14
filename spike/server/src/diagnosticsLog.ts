import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** One JSON object per line. Rotates so a noisy test cannot fill the disk. */
export function appendJsonLine(dir: string, file: string, record: unknown, maxBytes = 8 * 1024 * 1024): void {
  mkdirSync(dir, { recursive: true, mode: 0o750 });
  const path = join(dir, file);
  const line = JSON.stringify(record);
  if (line.length > 20_000 || line.includes('\n')) throw new Error('diagnostic record is too large');
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    size = 0;
  }
  if (size > 0 && size + line.length + 1 > maxBytes) rotate(dir, file);
  appendFileSync(path, `${line}\n`, { mode: 0o640 });
}

function rotate(dir: string, file: string): void {
  const path = join(dir, file);
  rmSync(join(dir, `${file}.2`), { force: true });
  try { renameSync(join(dir, `${file}.1`), join(dir, `${file}.2`)); } catch { /* no .1 yet */ }
  try { renameSync(path, join(dir, `${file}.1`)); } catch { /* the current file raced away */ }
}
