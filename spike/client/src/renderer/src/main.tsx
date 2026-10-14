import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installErrorCapture } from './lib/errorCapture';
import './styles.css';
installErrorCapture();
createRoot(document.getElementById('root')!).render(<App />);
