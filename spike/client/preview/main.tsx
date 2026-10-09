import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/renderer/src/App';
import { Overlay } from '../src/renderer/src/Overlay';
import { emitPreviewHotkey } from '../src/renderer/src/lib/previewBus';
import { PREVIEW_COMMUNITY_ID } from '../src/renderer/src/lib/previewApi';
import { getPreviewEngine, type PreviewDemo } from '../src/renderer/src/lib/previewEngine';
import '../src/renderer/src/styles.css';
import './preview.css';

const storeKey = `rn.radio.${PREVIEW_COMMUNITY_ID}`;
if (!localStorage.getItem(storeKey)) {
  localStorage.setItem(storeKey, JSON.stringify({ tuned: ['arty', 'logi', 'cmd'], tx: 'cmd' }));
}

function Preview() {
  const [demo, setDemo] = useState<PreviewDemo>('auto');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'F10') return;
      e.preventDefault();
      emitPreviewHotkey({ type: 'overlay' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
        <span className="preview-hint">G wheel · Space talk · scroll freq · Shift+scroll volume · right-click mute</span>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
