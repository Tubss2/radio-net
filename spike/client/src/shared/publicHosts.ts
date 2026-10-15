/**
 * Stable names on 5by5.app. DNS is two A records at the current VPS.
 * Cloudflare proxy stays off (grey cloud) so Caddy can finish an HTTP-01 challenge.
 * setup.sh still falls back to sslip.io when API_HOST and LK_HOST are unset.
 */
export const PUBLIC_API_HOST = 'api.5by5.app';
export const PUBLIC_VOICE_HOST = 'voice.5by5.app';
export const PUBLIC_API_ORIGIN = `https://${PUBLIC_API_HOST}`;
export const PUBLIC_VOICE_ORIGIN = `https://${PUBLIC_VOICE_HOST}`;
export const PUBLIC_VOICE_WSS = `wss://${PUBLIC_VOICE_HOST}`;
