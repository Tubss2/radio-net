import { createRoot } from 'react-dom/client';
import { Overlay } from './Overlay';
import './styles.css';
document.documentElement.classList.add('overlay-root');
document.body.style.background = 'transparent';
createRoot(document.getElementById('root')!).render(<Overlay />);
