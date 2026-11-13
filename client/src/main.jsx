import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.jsx';
import { App } from './App.jsx';
import { reloadOnce } from './components/PageLoading.jsx';
import { applyAppearance, rememberedAppearance } from './appearance.js';
import './styles.css';

// The Android and iPhone apps: already below the phone's status bar (mobile.css does not add its height again)
if (window.Capacitor) document.documentElement.classList.add('in-app');

// The installable app (31 Oct 2026): public/sw.js, on the live site only (not while developing). It keeps no patient data.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// A screen's file from before a new deploy could not load: reload for the new files (at most once a minute –
// components/PageLoading.jsx), instead of "This page could not open".
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnce()) event.preventDefault();
});

// The last person's look on this computer, until the server says who is logged in (no flash of another look).
applyAppearance(rememberedAppearance());

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
