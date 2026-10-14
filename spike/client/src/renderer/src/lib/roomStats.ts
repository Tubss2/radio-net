import type { Room } from 'livekit-client';
import type { StatRecord } from '../../../shared/voiceDiag';

interface StatsTrack {
  getRTCStatsReport?: () => Promise<RTCStatsReport | undefined>;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Audio WebRTC stats for one LiveKit room. Missing stats become an empty list. */
export async function collectAudioStats(room: Room): Promise<StatRecord[]> {
  const tracks: StatsTrack[] = [];
  const push = (track: unknown) => {
    if (track && typeof track === 'object' && 'getRTCStatsReport' in track) tracks.push(track as StatsTrack);
  };
  for (const pub of room.localParticipant.audioTrackPublications.values()) push(pub.track);
  for (const peer of room.remoteParticipants.values()) {
    for (const pub of peer.audioTrackPublications.values()) push(pub.track);
  }
  const records: StatRecord[] = [];
  for (const track of tracks) {
    if (!track.getRTCStatsReport) continue;
    const report = await track.getRTCStatsReport();
    report?.forEach((row) => {
      const item = row as Record<string, unknown>;
      records.push({
        type: typeof item.type === 'string' ? item.type : '',
        kind: typeof item.kind === 'string' ? item.kind : undefined,
        state: typeof item.state === 'string' ? item.state : undefined,
        nominated: typeof item.nominated === 'boolean' ? item.nominated : undefined,
        currentRoundTripTime: num(item.currentRoundTripTime),
        jitter: num(item.jitter),
        packetsLost: num(item.packetsLost),
        packetsReceived: num(item.packetsReceived),
        fractionLost: num(item.fractionLost),
        roundTripTime: num(item.roundTripTime),
      });
    });
  }
  return records;
}
