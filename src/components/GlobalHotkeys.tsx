import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { normaliseHotkey, useHotkeyStore, type HotkeyAction } from '@/stores/hotkeyStore';

const routes: Partial<Record<HotkeyAction, string>> = { home:'/home', discover:'/discover', library:'/library', settings:'/settings' };
const editable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(target.tagName));

export function GlobalHotkeys() {
  const navigate = useNavigate();
  const bindings = useHotkeyStore(state => state.bindings);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const close = document.querySelector<HTMLElement>('[data-portal-overlay="true"] [data-portal-close="true"]');
        if (close) { event.preventDefault(); close.click(); }
        return;
      }
      if (editable(event.target)) return;
      const chord = normaliseHotkey(event);
      if (!chord) return;
      const action = (Object.entries(bindings).find(([, binding]) => binding === chord)?.[0] ?? null) as HotkeyAction | null;
      if (!action) return;
      event.preventDefault();
      if (routes[action]) { navigate(routes[action]!); return; }
      if (action === 'librarySearch') { navigate('/library'); window.setTimeout(() => document.querySelector<HTMLInputElement>('[data-library-search="true"]')?.focus(), 0); }
      if (action === 'newInstance') { navigate('/library'); window.setTimeout(() => window.dispatchEvent(new Event('portal:new-instance')), 0); }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [bindings, navigate]);
  return null;
}
