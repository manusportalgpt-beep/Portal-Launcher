import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';
import './i18n';
import { playClick, playNav } from './lib/soundEngine';
import { useSettingsStore } from './stores/settingsStore';

// Global UI sounds — fires on every button/link click when uiSounds is enabled
document.addEventListener('click', (e) => {
  if (!useSettingsStore.getState().uiSounds) return;
  const target = e.target as HTMLElement;
  if (target.closest('a[href]')) { playNav(); return; }
  if (target.closest('button')) playClick();
}, true);

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
