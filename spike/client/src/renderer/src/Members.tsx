import { useCallback, useEffect, useState } from 'react';
import { Api, isReconnectError, type DeviceRow, type InviteRow } from './lib/api';
import { RECONNECTING } from '../../shared/net';

/** Admin list. A ban sticks to that device id. A new browser is a new device. */
export function Members({ api, communityId, onClose }: { api: Api; communityId: string; onClose: () => void }) {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [err, setErr] = useState('');
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [expires, setExpires] = useState('');

  const load = useCallback(async () => {
    const [nextDevices, nextInvites] = await Promise.all([api.devices(communityId), api.invites(communityId)]);
    setDevices(nextDevices);
    setInvites(nextInvites);
  }, [api, communityId]);

  useEffect(() => {
    let alive = true;
    load().catch((e) => { if (alive) setErr(isReconnectError(e) ? RECONNECTING : (e as Error).message); });
    return () => { alive = false; };
  }, [load]);

  const run = async (work: () => Promise<unknown>) => {
    setErr('');
    try {
      await work();
      await load();
    } catch (e) {
      setErr(isReconnectError(e) ? RECONNECTING : (e as Error).message);
    }
  };

  const mint = () => run(async () => {
    const uses = maxUses.trim();
    const parsed = uses ? Number(uses) : null;
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1)) throw new Error('Use cap must be a whole number, or left empty');
    let expiresAt: string | null = null;
    if (expires) {
      const at = Date.parse(expires);
      if (!Number.isFinite(at) || at <= Date.now()) throw new Error('Expiry must be in the future');
      expiresAt = new Date(at).toISOString();
    }
    await api.createInvite(communityId, { label: label.trim() || undefined, maxUses: parsed, expiresAt });
    setLabel('');
    setMaxUses('');
    setExpires('');
  });

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>People and invites</h3>
        <p className="sub" style={{ margin: 0 }}>A ban sticks to that browser. A new browser is a new device and can still join if it has an invite. Revoke the invite to close that door.</p>
        {err && <div className="err">{err}</div>}
        <div className="lbl">Devices</div>
        <div className="people">
          {devices.map((device) => (
            <div key={device.deviceId} className="person">
              <div>
                <strong>{device.callsign}</strong>
                <span className="sub"> {device.shortId} · {device.role}{device.revokedAt ? ' · banned' : ''}</span>
              </div>
              <div className="invite-actions">
                {device.revokedAt
                  ? <button className="btn sm" type="button" onClick={() => {
                    if (!confirm(`Restore ${device.callsign}? If that key was stolen, the thief comes back in too.`)) return;
                    void run(() => api.restoreDevice(communityId, device.deviceId));
                  }}>Restore</button>
                  : <button className="btn sm" type="button" onClick={() => {
                    if (!confirm(`Ban ${device.callsign} (${device.shortId})? This device stays out. A new browser can still join with an invite.`)) return;
                    void run(() => api.revokeDevice(communityId, device.deviceId));
                  }}>Ban</button>}
                <button className="btn sm ghost" type="button" onClick={() => void run(() => api.setDeviceRole(communityId, device.deviceId, device.role === 'admin' ? 'member' : 'admin'))}>
                  {device.role === 'admin' ? 'Make member' : 'Make admin'}
                </button>
              </div>
            </div>
          ))}
          {!devices.length && <div className="sub">No devices yet.</div>}
        </div>
        <div className="lbl">Invites</div>
        <div className="people">
          {invites.map((invite) => (
            <div key={invite.id} className="person">
              <div>
                <strong className="invite-code">{invite.code}</strong>
                <span className="sub"> {invite.label ? `${invite.label} · ` : ''}{invite.uses}{invite.maxUses === null ? '' : ` / ${invite.maxUses}`} uses{invite.revokedAt ? ' · revoked' : ''}</span>
              </div>
              {!invite.revokedAt && <button className="btn sm ghost" type="button" onClick={() => void run(() => api.revokeInvite(communityId, invite.id))}>Revoke</button>}
            </div>
          ))}
        </div>
        <label className="field">Label<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Friday op" /></label>
        <label className="field">Use cap (empty means unlimited)<input value={maxUses} onChange={(e) => setMaxUses(e.target.value)} inputMode="numeric" /></label>
        <label className="field">Expires (optional)<input type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button className="btn ghost" type="button" onClick={() => void mint()}>New invite</button>
          <button className="btn primary" type="button" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
