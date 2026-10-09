/** Browser origins that may call the API. The desktop app sends no origin, or the string "null" from file://. */
export function allowBrowserOrigin(origin: string | undefined): boolean {
  if (!origin || origin === 'null') return true;
  if (origin === 'https://tubss2.github.io') return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:') return false;
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}
