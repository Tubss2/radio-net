import { canonicalJoin, tokenHasDevice } from '../../../shared/identity';
import { Api, ApiError, type JoinResult } from './api';
import { signCanonical, type HeldDevice } from './deviceKey';
import { isPreview } from './previewMode';

const NOT_ENROLLED = 'This device is not enrolled.';

export async function openSession(api: Api, input: {
  callsign: string;
  device: HeldDevice | null;
  inviteCode?: string;
  communityId?: string;
  legacyToken?: string | null;
}): Promise<JoinResult> {
  if (isPreview || !input.device) return api.join(input.inviteCode || '', input.callsign);
  const device = input.device;

  if (input.communityId) {
    try {
      const challenge = await api.challenge(input.communityId, device.deviceId);
      const signature = await signCanonical(
        device.privateKey,
        canonicalJoin(challenge.challengeId, challenge.nonce, input.communityId, device.deviceId),
      );
      return await api.joinSigned(input.communityId, {
        challengeId: challenge.challengeId,
        deviceId: device.deviceId,
        signature,
        callsign: input.callsign,
      });
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
      if (!canTryInvite(err) && !(err instanceof ApiError && (err.status === 401 || err.status === 403))) throw err;
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
      throw err;
    }
  }

  throw new Error('This browser is not on this server yet. Enter the invite code once.');
}

function canTryInvite(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.routeMissing) return true;
  return err.status === 404 && err.message === NOT_ENROLLED;
}
