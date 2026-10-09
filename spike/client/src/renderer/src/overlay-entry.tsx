import { createRoot } from 'react-dom/client';
import { Overlay } from './Overlay';
import './styles.css';
document.body.style.background = 'transparent';
createRoot(document.getElementById('root')!).render(<Overlay />);
