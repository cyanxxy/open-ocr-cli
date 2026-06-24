import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.tsx';
import './index.css';

// Fail loudly with a clear message if the mount point is missing (e.g. a broken
// deploy or a renamed id) rather than a cryptic "Cannot read properties of null"
// from the non-null assertion (audit U-14).
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in document. Check index.html.');
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);