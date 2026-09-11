import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { LoaderCircle } from 'lucide-react';

const FALLBACK_PHRASES = [
  'Скачиваю архив модпака…',
  'Читаю манифест…',
  'Получаю метаданные модов…',
  'Почти готово…',
];

/**
 * Full overlay shown while the modpack manifest is being prepared
 * (preview_remote_modpack). It combines real Rust progress events
 * (`pack-preview-progress`) with a smooth fallback simulation when the
 * backend does not emit events (e.g. a very fast local archive).
 *
 * `active=false` flashes «Готово!» for a moment and then unmounts itself.
 */
export function PackPreviewLoading({ active }: { active: boolean }) {
  const [visible, setVisible] = useState(active);
  const [percent, setPercent] = useState(0);
  const [phrase, setPhrase] = useState('Подключаюсь…');
  const startRef = useRef(0);
  const realRef = useRef<number | null>(null);

  useEffect(() => {
    const unsub = listen<any>('pack-preview-progress', e => {
      const p = e.payload ?? {};
      if (typeof p.percent === 'number') {
        realRef.current = p.percent;
        setPercent(Math.max(realRef.current ?? 0, p.percent));
      }
      if (typeof p.message === 'string' && p.message.trim()) setPhrase(p.message);
    });
    return () => { void unsub.then(fn => fn()); };
  }, []);

  useEffect(() => {
    if (active) {
      setVisible(true);
      setPercent(0);
      setPhrase('Скачиваю архив модпака…');
      startRef.current = performance.now();
      realRef.current = null;
      const timer = setInterval(() => {
        const elapsed = (performance.now() - startRef.current) / 1000;
        // Fallback curve: reach ~90% in 14s. Real events override it.
        const simulated = Math.min(88, Math.round((elapsed / 14) * 88));
        const next = realRef.current != null ? Math.max(realRef.current, simulated) : simulated;
        setPercent(next);
        // Rotate the fallback phrases as the simulated progress climbs.
        if (realRef.current == null) {
          const idx = Math.min(FALLBACK_PHRASES.length - 1, Math.floor((next / 88) * FALLBACK_PHRASES.length));
          const candidate = FALLBACK_PHRASES[idx];
          if (candidate && candidate !== phrase) setPhrase(candidate);
        }
      }, 180);
      return () => clearInterval(timer);
    }
    if (visible) {
      setPercent(100);
      setPhrase('Готово!');
      const t = setTimeout(() => setVisible(false), 700);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[180] flex flex-col items-center justify-center p-6"
      style={{ background:'rgba(0,0,0,0.62)', backdropFilter:'blur(4px)' }}>
      <div className="flex w-full max-w-sm flex-col items-center rounded-2xl px-6 py-6"
        style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-lg)' }}>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{ background:'color-mix(in srgb, var(--color-primary) 14%, transparent)', color:'var(--color-primary)' }}>
          <LoaderCircle className="h-6 w-6 animate-spin" />
        </div>
        <p className="mt-4 text-sm font-black" style={{ color:'var(--color-text)' }}>
          Пожалуйста, подождите… {Math.min(100, Math.round(percent))}%
        </p>
        <p className="mt-1 text-[11px]" style={{ color:'var(--color-text-secondary)' }}>
          {phrase}
        </p>
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full" style={{ background:'var(--color-surface-2)' }}>
          <div className="h-full rounded-full transition-all duration-200"
            style={{ width:`${Math.min(100, Math.round(percent))}%`, background:'var(--color-primary)' }} />
        </div>
        <p className="mt-3 text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>
          Читаю содержимое сборки перед установкой
        </p>
      </div>
    </div>
  );
}

export default PackPreviewLoading;
