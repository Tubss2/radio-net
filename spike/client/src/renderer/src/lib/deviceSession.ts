import { canonicalJoin, tokenHasDevice } from '../../../shared/identity';
import { Api, ApiError, type JoinResult } from './api';

const NOT_ENROLLED = 'This device is not enrolled.';
const ALREADY_ENROLLED = 'already_enrolled';

async function signChallenge(
  api: Api,
  communityId: string,
  device: HeldDevice,
  callsign: string,
  sign: (message: string) => Promise<string>,
): Promise<JoinResult> {
  const challenge = await api.challenge(communityId, device.deviceId);
  const signature = await sign(canonicalJoin(challenge.challengeId, challenge.nonce, communityId, device.deviceId));
  return api.joinSigned(communityId, {
    challengeId: challenge.challengeId,
    deviceId: device.deviceId,
    signature,
    callsign,
  });
}

/** Community id from a refusal that means "prove this key", or null when the error is something else. */
function enrolledCommunity(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.code !== ALREADY_ENROLLED || !err.communityId) return null;
  return err.communityId;
}

export interface HeldDevice {
  deviceId: string;
  publicKeySpki: string;
}

/**
 * Same order as the web client: signed challenge, then migrate a legacy session,
 * then register with the invite. A server that has no register route still accepts POST /api/join.
 * The renderer passes a sign function. It never holds the private key.
 */
export async function openDeviceSession(api: Api, input: {
  callsign: string;
  device: HeldDevice | null;
  sign: (message: string) => Promise<string>;
  inviteCode?: string;
  communityId?: string;
  legacyToken?: string | null;
}): Promise<JoinResult> {
  if (!input.device) return api.join(input.inviteCode || '', input.callsign);
  const device = input.device;

  if (input.communityId) {
    try {
      return await signChallenge(api, input.communityId, device, input.callsign, input.sign);
    } catch (err) {
      if (!canTryInvite(err)) throw err;
    }
  }

  if (input.legacyToken && !tokenHasDevice(input.legacyToken)) {
    try {
      const legacy = new Api(api.baseUrl, input.legacyToken, null);
      legacy.retryWaits = api.retryWaits;
      return await legacy.migrate({
        deviceId: device.deviceId,
        publicKeySpki: device.publicKeySpki,
        callsign: input.callsign,
      });
    } catch (err) {
      const communityId = enrolledCommunity(err);
      if (communityId) return signChallenge(api, communityId, device, input.callsign, input.sign);
      const migrateUsed = err instanceof ApiError && err.code === 'migrate_used';
      if (!canTryInvite(err) && !(err instanceof ApiError && (err.status === 401 || err.status === 403)) && !migrateUsed) throw err;
    }
  }

  if (input.inviteCode) {
    try {
      return await api.register({
        inviteCode: input.inviteCode,
        callsign: input.callsign,
        deviceId: device.deviceId,
        publicKeySpki: device.publicKeySpki,
      });
    } catch (err) {
      if (err instanceof ApiError && err.routeMissing) return api.join(input.inviteCode, input.callsign);
      const communityId = enrolledCommunity(err);
      if (communityId) return signChallenge(api, communityId, device, input.callsign, input.sign);
      throw err;
    }
  }

  throw new Error('This PC is not on this server yet. Enter the invite code once.');
}

function canTryInvite(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.routeMissing) return true;
  return err.status === 404 && err.message === NOT_ENROLLED;
}
