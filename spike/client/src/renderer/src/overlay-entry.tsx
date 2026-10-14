import { createRoot } from 'react-dom/client';
import { Overlay } from './Overlay';
import { installErrorCapture } from './lib/errorCapture';
import './styles.css';
installErrorCapture();
document.documentElement.classList.add('overlay-root');
document.body.style.background = 'transparent';
createRoot(document.getElementById('root')!).render(<Overlay />);
