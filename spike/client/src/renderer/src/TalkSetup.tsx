import { useEffect, useRef, useState } from 'react';
import { HELPER_DOWNLOAD_URL, HELPER_SOURCE_URL, helperCodeFromHash } from '../../shared/helperLink';
import { DESKTOP_RELEASE_URL, PTT_CHOOSER_INTRO, helperSetupSteps, pttChoices } from '../../shared/pttChooser';
import { describePttMode } from '../../shared/pttMode';

/** One button that leads into the browser, phone, or helper setup that already exists. */
export function TalkSetup({ talkMode, talkLabel, phoneLinked, helperLinked, onBrowser, onPhone, onHelperSlot }: {
  talkMode: 'hold' | 'voice';
  talkLabel: string;
  phoneLinked: boolean;
  helperLinked: boolean;
  onBrowser: () => void;
  onPhone: () => void;
  onHelperSlot?: (slot: HTMLDivElement | null) => void;
}) {
  const [open, setOpen] = useState(() => helperCodeFromHash(window.location.hash) != null);
  const helperSlot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onHelperSlot?.(open ? helperSlot.current : null);
    return () => onHelperSlot?.(null);
  }, [open, onHelperSlot]);
  const current = describePttMode({ talkMode, talkLabel, phoneLinked, helperLinked });
  const close = () => setOpen(false);
  const [browser, phone, helper, desktop] = pttChoices;
  return (
    <div className="ptt-setup-block">
      <button className="btn primary ptt-setup" type="button" onClick={() => setOpen(true)}>Set up push to talk</button>
      <p className="sub ptt-current">{current}</p>
      {open && (
        <div className="modal-bg" onClick={close}>
          <div className="modal talk-setup-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>Set up push to talk</h3>
            <p className="sub" style={{ margin: 0 }}>{PTT_CHOOSER_INTRO}</p>
            <p className="sub" style={{ margin: 0 }}>{current}</p>
            <div className="talk-chooser">
              <button className="talk-choice" type="button" onClick={() => { close(); onBrowser(); }}>
                <span className="talk-rank">{browser.rank}</span>
                <span className="talk-choice-body">
                  <strong>{browser.title}</strong>
                  <span>{browser.body}</span>
                </span>
              </button>
              <button className="talk-choice" type="button" onClick={() => { close(); onPhone(); }}>
                <span className="talk-rank">{phone.rank}</span>
                <span className="talk-choice-body">
                  <strong>{phone.title}</strong>
                  <span>{phone.body}</span>
                </span>
              </button>
              <div className="talk-choice">
                <span className="talk-rank">{helper.rank}</span>
                <div className="talk-choice-body">
                  <strong>{helper.title}</strong>
                  <span>{helper.body}</span>
                  <ol className="helper-steps">
                    <li><a href={HELPER_DOWNLOAD_URL}>{helperSetupSteps[0].replace(/\.$/, '')}</a></li>
                    <li>{helperSetupSteps[1]}</li>
                    <li>
                      {helperSetupSteps[2]}
                      <div ref={helperSlot} />
                    </li>
                  </ol>
                  <span className="talk-links">
                    <a href={HELPER_SOURCE_URL} target="_blank" rel="noreferrer">Source on GitHub</a>
                  </span>
                </div>
              </div>
              <div className="talk-choice">
                <span className="talk-rank">{desktop.rank}</span>
                <div className="talk-choice-body">
                  <strong>{desktop.title}</strong>
                  <span>{desktop.body}</span>
                  <span className="talk-links">
                    <a href={DESKTOP_RELEASE_URL} target="_blank" rel="noreferrer">Latest desktop release</a>
                  </span>
                </div>
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
