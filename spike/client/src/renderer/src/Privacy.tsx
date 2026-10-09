/** Shown once, before the hook is installed. The facts match docs/PRIVACY.md for this build. */
export function PrivacyConsent({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="onboard">
      <div className="titlebar" />
      <div className="box privacy">
        <h1>Before this app listens</h1>
        <p>Radio Net is a voice radio. It has no account and it does not send usage data anywhere. Here is exactly what it reads on this PC.</p>
        <ul>
          <li>The keys and mouse buttons you bind for push-to-talk, the channel wheel, the overlay, and per-channel shortcuts. While the channel wheel is open it also watches Escape, the number keys, and the scroll wheel.</li>
          <li>Other keystrokes reach the hook and are dropped inside this app. They are not saved and they are not sent to the server. You can pause keybinds in settings; that removes the hook. Quitting the app removes it too.</li>
          <li>The microphone opens when you tune a channel you can talk on. The track stays muted until you hold push-to-talk. Windows may show the microphone as in use the whole time you are tuned in. Audio is sent only while the talk key is held.</li>
          <li>Your callsign, invite code, and (if you create a community) admin key are stored on this PC. On Windows that file is encrypted with DPAPI. The callsign and invite go to the server you join. Voice goes there too. The person who runs that server can see your IP and callsign and can hear the radio. Voice is not end-to-end encrypted.</li>
          <li>A packaged app checks GitHub for an update. The installer is not code-signed. The app asks before it downloads one.</li>
        </ul>
        <button className="btn primary privacy-continue" type="button" onClick={onAccept}>Continue</button>
      </div>
    </div>
  );
}

export function PrivacyNotes({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal privacy-notes" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>Privacy notes</h3>
        <ul>
          <li>Keybinds watch only the shortcuts you set, plus wheel controls while the wheel is open. Pause them in this window to unhook the keyboard and mouse.</li>
          <li>The microphone is open while a channel you can talk on is tuned, and muted until push-to-talk.</li>
          <li>Nothing is sent to an analytics service. The local log is on this PC and strips admin keys and session tokens.</li>
          <li>The community server you join receives your IP, callsign, invite code, and voice. Pick a server you trust.</li>
          <li>Updates come from the public GitHub releases for Tubss2/radio-net and are not code-signed.</li>
        </ul>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn primary" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
