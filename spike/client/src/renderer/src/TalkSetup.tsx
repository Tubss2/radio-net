import { useState } from 'react';
import { HELPER_DOWNLOAD_URL, HELPER_SOURCE_URL } from '../../shared/helperLink';
import { describePttMode } from '../../shared/pttMode';

/** One button that leads into the browser, phone, or helper setup that already exists. */
export function TalkSetup({ talkMode, talkLabel, phoneLinked, helperLinked, onBrowser, onPhone, onHelper }: {
  talkMode: 'hold' | 'voice';
  talkLabel: string;
  phoneLinked: boolean;
  helperLinked: boolean;
  onBrowser: () => void;
  onPhone: () => void;
  onHelper: () => void;
}) {
  const [open, setOpen] = useState(false);
  const current = describePttMode({ talkMode, talkLabel, phoneLinked, helperLinked });
  const close = () => setOpen(false);
  return (
    <div className="ptt-setup-block">
      <button className="btn primary ptt-setup" type="button" onClick={() => setOpen(true)}>Set up push to talk</button>
      <p className="sub ptt-current">{current}</p>
      {open && (
        <div className="modal-bg" onClick={close}>
          <div className="modal talk-setup-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>Set up push to talk</h3>
            <p className="sub" style={{ margin: 0 }}>{current}</p>
            <div className="talk-chooser">
              <button className="talk-choice" type="button" onClick={() => { close(); onBrowser(); }}>
                <strong>Browser only</strong>
                <span>Open mic (voice activation), or a push-to-talk key while this window is focused.</span>
              </button>
              <button className="talk-choice" type="button" onClick={() => { close(); onPhone(); }}>
                <strong>For the security conscious</strong>
                <span>Use your phone as push-to-talk. Open a link or scan a QR code. Press and hold the phone screen to talk.</span>
              </button>
              <div className="talk-choice">
                <strong>Small open-source helper</strong>
                <span>A Windows program that only monitors the keys you assign, and links to this page. It does not hear the microphone.</span>
                <span className="talk-links">
                  <a href={HELPER_DOWNLOAD_URL}>Download RadioNetHelper.exe</a>
                  <a href={HELPER_SOURCE_URL} target="_blank" rel="noreferrer">Source on GitHub</a>
                </span>
                <button className="btn sm" type="button" onClick={() => { close(); onHelper(); }}>Link helper</button>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn ghost" type="button" onClick={close}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
