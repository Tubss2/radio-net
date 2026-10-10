import { useEffect, useState } from 'react';
import { diagnosticsText } from '../../shared/diagnostics';
import { soundPrefsFrom, type SoundPrefs } from '../../shared/sounds';
import { APP_VERSION } from '../../shared/version';
import type { Profile, ServerEntry } from '../../shared/profile';
import type { Keybinds } from '../../shared/types';
import { updateStatusText, type UpdateCheckState } from '../../shared/updates';
import { bridge } from './bridge';
import { SoundsSettings } from './SoundsSettings';

export function OptionsMenu({ profile, server, binds, overlayOn, wheelOn, simpleOn, hotkeysOn, onOverlay, onWheel, onSimple, onHotkeys, onSounds, onServer, onKeybinds, onPhone, onPrivacy, onReset, onClose }: {
  profile: Profile;
  server: ServerEntry;
  binds: Keybinds;
  overlayOn: boolean;
  wheelOn: boolean;
  simpleOn: boolean;
  hotkeysOn: boolean;
  onOverlay: (on: boolean) => void;
  onWheel: (on: boolean) => void;
  onSimple: (on: boolean) => void;
  onHotkeys: (on: boolean) => void;
  onSounds: (next: SoundPrefs) => void;
  onServer: (server: ServerEntry) => void;
  onKeybinds: () => void;
  onPhone: () => void;
  onPrivacy: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [adminDraft, setAdminDraft] = useState('');
  const [adminMsg, setAdminMsg] = useState('');
  const [update, setUpdate] = useState<UpdateCheckState | null>(null);
  const [diag, setDiag] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const offReady = bridge.onUpdateReady((info) => setUpdate({ state: 'ready', version: info.version }));
    const offAvail = bridge.onUpdateAvailable((info) => setUpdate((cur) => (cur?.state === 'ready' ? cur : { state: 'available', version: info.version })));
    return () => { offReady(); offAvail(); };
  }, []);

  const saveAdmin = () => {
    const key = adminDraft.trim();
    if (!key) { setAdminMsg('Paste an admin key first.'); return; }
    if (key.length > 200) { setAdminMsg('That key is too long.'); return; }
    onServer({ ...server, adminKey: key });
    setAdminDraft('');
    setAdminMsg('Admin key saved for this community.');
  };

  const forgetAdmin = () => {
    onServer({ ...server, adminKey: undefined, rememberAdmin: false });
    setAdminDraft('');
    setAdminMsg('Admin key forgotten on this PC.');
  };

  const checkUpdates = async () => {
    setUpdate({ state: 'checking' });
    try {
      setUpdate(await bridge.checkForUpdates());
    } catch {
      setUpdate({ state: 'error', message: 'Could not check for updates.' });
    }
  };

  const copyDiagnostics = async () => {
    const facts = await bridge.appFacts();
    const text = diagnosticsText({
      appVersion: APP_VERSION,
      platform: facts.platform,
      arch: facts.arch,
      packaged: facts.packaged,
      privacyAccepted: profile.privacyAccepted,
      hotkeysEnabled: hotkeysOn,
      overlayOn,
      wheelOn,
      soundsOn: profile.soundsOn,
      soundPtt: profile.soundPtt,
      soundTx: profile.soundTx,
      simpleOn,
      serverCount: profile.servers.length,
      binds,
    });
    try {
      await navigator.clipboard.writeText(text);
      setDiag('');
      setCopied(true);
    } catch {
      setCopied(false);
      setDiag(text);
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal options" role="dialog" aria-label="Options" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h3 style={{ margin: 0 }}>Options</h3>
          <span className="about">v{APP_VERSION}</span>
        </div>

        <div className="opt-row">
          <span>Keybinds</span>
          <button className="btn sm" type="button" onClick={onKeybinds}>Edit keys</button>
        </div>
        <label className="opt-row">
          <span>Listen for keybinds</span>
          <input type="checkbox" checked={hotkeysOn} onChange={(e) => onHotkeys(e.target.checked)} />
        </label>
        <label className="opt-row">
          <span>Overlay</span>
          <input type="checkbox" checked={overlayOn} onChange={(e) => onOverlay(e.target.checked)} />
        </label>
        <label className="opt-row">
          <span>Channel wheel</span>
          <input type="checkbox" checked={wheelOn} onChange={(e) => onWheel(e.target.checked)} />
        </label>
        <label className="opt-row">
          <span>Simple mode</span>
          <input type="checkbox" checked={simpleOn} onChange={(e) => onSimple(e.target.checked)} />
        </label>

        <div className="opt-section">
          <div className="lbl">Admin key</div>
          <p className="sub" style={{ margin: 0 }}>
            {server.adminKey ? 'A key is saved for this community. Paste a new one to replace it.' : 'Paste the admin key for this community.'}
          </p>
          <input className="admin-key" type="password" autoComplete="off" spellCheck={false} value={adminDraft} placeholder="Paste admin key" onChange={(e) => { setAdminDraft(e.target.value); setAdminMsg(''); }} />
          <div className="opt-row">
            <button className="btn sm" type="button" onClick={saveAdmin}>Save</button>
            <button className="btn sm ghost" type="button" onClick={forgetAdmin} disabled={!server.adminKey}>Forget</button>
          </div>
          {adminMsg && <p className="sub" style={{ margin: 0 }}>{adminMsg}</p>}
        </div>

        <SoundsSettings sounds={soundPrefsFrom(profile)} onSounds={onSounds} />

        <div className="opt-section">
          <div className="opt-row">
            <span>Phone as the talk button</span>
            <button className="btn sm" type="button" onClick={onPhone}>Set up</button>
          </div>
        </div>

        <div className="opt-section">
          <div className="opt-row">
            <span>Updates</span>
            <button className="btn sm" type="button" onClick={() => void checkUpdates()} disabled={update?.state === 'checking'}>Check for updates</button>
          </div>
          {update && <p className="sub" style={{ margin: 0 }} role="status">{updateStatusText(update)}</p>}
          {update?.state === 'available' && <button className="btn sm primary" type="button" onClick={() => bridge.downloadUpdate()}>Download</button>}
          {update?.state === 'ready' && <button className="btn sm primary" type="button" onClick={() => bridge.installUpdate()}>Restart now</button>}
        </div>

        <div className="opt-section">
          <div className="lbl">Testing</div>
          <div className="opt-row">
            <button className="btn sm ghost" type="button" onClick={() => void bridge.showLogs()}>Show logs folder</button>
            <button className="btn sm ghost" type="button" onClick={() => void copyDiagnostics()}>{copied ? 'Copied' : 'Copy diagnostics'}</button>
          </div>
          {diag && <pre className="keybox">{diag}</pre>}
          <button className="btn sm ghost" type="button" onClick={onReset}>Reset settings</button>
          <button className="btn sm ghost" type="button" onClick={onPrivacy}>Privacy notes</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn primary" type="button" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
