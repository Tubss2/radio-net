import { createRoot } from 'react-dom/client';
import { App } from '../src/renderer/src/App';
import { PhoneRemote } from '../src/renderer/src/PhoneRemote';
import { parsePhoneHash } from '../src/shared/phonePage';
import '../src/renderer/src/styles.css';

document.documentElement.classList.add('web');
const phone = parsePhoneHash(location.hash);
const root = createRoot(document.getElementById('root')!);
if (phone) root.render(<PhoneRemote code={phone.code} apiBase={phone.api} />);
else root.render(<App />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
}
