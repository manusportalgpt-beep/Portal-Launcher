import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { normaliseHotkey, useHotkeyStore, type HotkeyAction } from '@/stores/hotkeyStore';

const routes: Partial<Record<HotkeyAction, string>> = { home:'/home', discover:'/discover', library:'/library', settings:'/settings' };
const editable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(target.tagName));

export function GlobalHotkeys() {
  const navigate = useNavigate();
  const bindings = useHotkeyStore(state => state.bindings);
  const keyboardNavigationEnabled = useHotkeyStore(state => state.keyboardNavigationEnabled);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const close = document.querySelector<HTMLElement>('[data-portal-overlay="true"] [data-portal-close="true"]');
        if (close) { event.preventDefault(); close.click(); }
        return;
      }
      if (editable(event.target)) return;
      if (keyboardNavigationEnabled && !document.querySelector('[data-portal-overlay="true"]')) {
        const focusable = Array.from(document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [role="button"], [tabindex]:not([tabindex="-1"])'))
          .filter(element => element.offsetParent !== null && !element.closest('[aria-hidden="true"]'));
        if (event.code === 'Enter' && document.activeElement instanceof HTMLElement && focusable.includes(document.activeElement)) {
          event.preventDefault(); document.activeElement.click(); return;
        }
        const direction = event.code === 'ArrowRight' || event.code === 'ArrowDown' ? 1 : event.code === 'ArrowLeft' || event.code === 'ArrowUp' ? -1 : 0;
        if (direction && focusable.length) {
          event.preventDefault();
          const current = focusable.indexOf(document.activeElement as HTMLElement);
          const next = current < 0 ? (direction > 0 ? 0 : focusable.length - 1) : (current + direction + focusable.length) % focusable.length;
          focusable[next].focus({ preventScroll: true });
          focusable[next].scrollIntoView({ block:'nearest', inline:'nearest', behavior:'smooth' });
          return;
        }
      }
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
  }, [bindings, keyboardNavigationEnabled, navigate]);
  return null;
}
