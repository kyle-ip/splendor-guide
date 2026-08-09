import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { I18nProvider } from '@/i18n/I18nProvider';
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY } from '@/i18n/messages';
import { initAutohideScrollbar } from '@/lib/autohideScrollbar';
import './index.css';

try {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  document.documentElement.lang =
    stored === 'zh' ? 'zh-CN' : stored === 'en' ? 'en' : DEFAULT_LOCALE === 'zh' ? 'zh-CN' : 'en';
} catch {
  document.documentElement.lang = 'en';
}

initAutohideScrollbar();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
        <App />
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
);
