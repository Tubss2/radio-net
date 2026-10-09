import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/renderer/src/App';
import { Overlay } from '../src/renderer/src/Overlay';
import { emitPreviewHotkey, emitPreviewUpdate } from '../src/renderer/src/lib/previewBus';
import { getPreviewEngine, type PreviewDemo } from '../src/renderer/src/lib/previewEngine';
import '../src/renderer/src/styles.css';
import './preview.css';

const PROFILE_KEY = 'rn.profile';
if (!localStorage.getItem(PROFILE_KEY)) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify({
    callsign: 'Toby',
    servers: [{
      id: 'wdnz',
      name: 'War Dogs NZ',
      url: 'preview',
      inviteCode: 'K7QM-2XPA',
      adminKey: 'rnk_preview',
      rememberAdmin: true,
      lastUsed: new Date().toISOString(),
      token: 'preview',
      tokenExp: Date.now() + 86_400_000,
    }],
    keybinds: null,
    overlayOn: true,
    radios: { wdnz: { tuned: ['arty', 'logi', 'cmd'], tx: 'cmd', volume: {}, muted: {}, pan: {} } },
  }));
}

function Preview() {
  const [demo, setDemo] = useState<PreviewDemo>('auto');
  const run = (kind: PreviewDemo) => {
    setDemo(kind);
    void getPreviewEngine()?.demo(kind);
  };

  return (
    <div className="preview-desktop">
      <div className="preview-game">
        <div className="preview-caption">WARDOGS preview · corner overlay sits on the game</div>
      </div>
      <div className="preview-corner">
        <Overlay talkersOnly />
      </div>
      <div className="preview-window">
        <App />
      </div>
      <div className="preview-dev">
        <span className="preview-dev-label">Preview</span>
        <button className={demo === 'auto' ? 'on' : ''} onClick={() => run('auto')}>Auto talkers</button>
        <button className={demo === 'silence' ? 'on' : ''} onClick={() => run('silence')}>Silence</button>
        <button className={demo === 'one' ? 'on' : ''} onClick={() => run('one')}>Rhys on Command</button>
        <button className={demo === 'two' ? 'on' : ''} onClick={() => run('two')}>Two talkers</button>
        <button className={demo === 'you' ? 'on' : ''} onClick={() => run('you')}>You talk</button>
        <button className={demo === 'gone' ? 'on' : ''} onClick={() => run('gone')}>Command deleted</button>
        <button onClick={() => emitPreviewHotkey({ type: 'overlay' })}>Overlay F10</button>
        <button onClick={() => emitPreviewUpdate({ version: '9.9.9' })}>Update ready</button>
        <span className="preview-hint">F2 wheel · Space talk · scroll freq · Shift+scroll volume · right-click mute</span>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
