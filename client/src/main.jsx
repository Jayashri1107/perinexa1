import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.jsx';
import { App } from './App.jsx';
import { applyAppearance, rememberedAppearance } from './appearance.js';
import './styles.css';

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
