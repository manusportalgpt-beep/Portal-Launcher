import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import './pixel-ui.css';
import './pixel-motion.css';
// Глобальный переоформляющий слой. Идёт последним: он переопределяет
// скругления и элементы формы во всех окнах сразу.
import './pixel-global.css';
import './i18n';
import { playClick, playNav } from './lib/soundEngine';
import { initRangeFill } from './lib/range-fill';
import { useSettingsStore } from './stores/settingsStore';

// Заливка ползунков (зелёным только до бегунка, дальше серый) — WebKit
// не умеет рисовать заполненную часть сам, значение прокидывается в CSS.
initRangeFill();

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
    {/* Без границы ошибок любая поломка одного экрана гасила всё дерево:
        игрок видел чёрный экран без объяснений. */}
    <ErrorBoundary>
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
