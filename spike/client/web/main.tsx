import { createRoot } from 'react-dom/client';
import { App } from '../src/renderer/src/App';
import '../src/renderer/src/styles.css';

document.documentElement.classList.add('web');
createRoot(document.getElementById('root')!).render(<App />);
