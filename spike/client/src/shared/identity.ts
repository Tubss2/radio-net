/** Canonical sign-in string. Newline between fields, no trailing newline. Must match the server. */
export function canonicalJoin(challengeId: string, nonce: string, communityId: string, deviceId: string): string {
  return `rn-join.v1\n${challengeId}\n${nonce}\n${communityId}\n${deviceId}`;
}

/** True when this HMAC session was minted for an enrolled device. */
export function tokenHasDevice(token: string): boolean {
  const part = token.split('.')[0] ?? '';
  try {
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(padded)) as { did?: unknown };
    return typeof json.did === 'string' && /^[0-9a-f]{64}$/.test(json.did);
  } catch {
    return false;
  }
}
