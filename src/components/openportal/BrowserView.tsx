import { useEffect, useRef, useState } from 'react';
import { invoke } from '@/lib/invoke-shim';
import { listen } from '@tauri-apps/api/event';
import { Download, Globe, Loader2, MousePointer2, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import type { BrowserCard as BrowserCardData } from '@/lib/opencore/types';

/** Прозрачный пиксель: заглушка src до первого кадра. */
const BLANK =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
interface Frame {
  data: string;
  seq: number;
  cursor_x: number;
  cursor_y: number;
  cursor_visible: boolean;
  url: string;
  title: string;
  downloading: string | null;
  verdict: HostVerdict | null;
}

/** Что удалось выяснить про домен: официальный, подделка или неизвестный. */
interface HostVerdict {
  host: string;
  domain: string;
  official_brand: string | null;
  impersonates: string | null;
  official_domain: string | null;
  verdict: string;
  verified: boolean;
  blocked_reason: string | null;
}

/**
 * Карточка браузера ИИ прямо в чате.
 *
 * Настоящего окна на экране нет: браузер работает без окна (headless), а
 * кадры приходят событием `browser://frame` из Rust. Здесь мы просто
 * показываем последний кадр и рисуем поверх него курсор ИИ — так видно,
 * куда он кликает, хотя сам курсор неотличим от системного.
 *
 * Кадры приходят десятками в секунду, поэтому картинку не храним в React
 * state: иначе на каждый кадр перерисовывалось бы всё дерево чата.
 * Вместо этого `<img>` обновляется напрямую через ref, а в state лежит
 * только номер кадра — он меняется редко и служит ключом для курсора.
 */
export function BrowserView({ card }: { card: BrowserCardData }) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [seq, setSeq] = useState(0);
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [url, setUrl] = useState(card.url);
  const [title, setTitle] = useState(card.title);
  const [domain, setDomain] = useState<HostVerdict | null>(null);
  const [closed, setClosed] = useState(!card.active);

  // Слушаем кадры. Один слушатель на карточку, и он снимается при уходе.
  useEffect(() => {
    let alive = true;
    const un = listen<Frame>('browser://frame', (e) => {
      if (!alive) return;
      const f = e.payload;
      const el = imgRef.current;
      if (el) {
        // src ставим напрямую: обновление атрибута не трогает React-дерево.
        el.src = `data:image/jpeg;base64,${f.data}`;
        if (el.naturalWidth && el.naturalHeight) {
          setBox({ w: el.naturalWidth, h: el.naturalHeight });
        }
      }
      setSeq(f.seq);
      if (f.cursor_visible) {
        setCursor({ x: f.cursor_x, y: f.cursor_y, visible: true });
      }
      if (f.url) setUrl(f.url);
      if (f.title) setTitle(f.title);
      if (f.verdict) setDomain(f.verdict);
    });
    return () => {
      alive = false;
      void un.then((off) => off());
    };
  }, []);

  const stop = async () => {
    try {
      await invoke('op_browser_close');
    } catch {
      /* уже закрыт */
    }
    setClosed(true);
  };

  // Кадр приходит в фиксированном размере (Rust просит 900x640), и контейнер
  // имеет тот же пропорции, поэтому координаты кадра переводятся в
  // проценты простым делением. naturalWidth используем, если известен.
  const fw = box.w || 900;
  const fh = box.h || 640;
  const ratio = fw / fh;

  return (
    <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]" style={{ background: 'var(--color-surface-2)' }}>
        <Globe size={12} style={{ color: closed ? 'var(--color-text-tertiary)' : 'var(--color-primary)' }} />
        <span className="truncate font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
          {title || 'Браузер ИИ'}
        </span>
        <span className="truncate" style={{ color: 'var(--color-text-tertiary)' }}>{url}</span>
        {/* Метка проверки домена: официальный / не подтверждён / подделка. */}
        {domain && !closed && (
          <span
            title={domain.impersonates
              ? `Это не ${domain.impersonates}. Официальный: ${domain.official_domain}`
              : domain.verdict}
            className="ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold"
            style={{
              background: domain.verified ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.18)',
              color: domain.verified ? '#22c55e' : '#eab308',
            }}>
            {domain.verified ? <ShieldCheck size={10} /> : <ShieldAlert size={10} />}
            {domain.verified
              ? `официальный${domain.official_brand ? ` · ${domain.official_brand}` : ''}`
              : domain.impersonates
                ? 'НЕ официальный'
                : 'не проверен'}
          </span>
        )}
        {card.downloads.length > 0 && (
          <span className="flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}
            title={`Скачано в кеш лаунчера: ${card.downloads.join(', ')}`}>
            <Download size={11} />
            {card.downloads.length}
          </span>
        )}
        {!closed && (
          <button onClick={() => void stop()} title="Остановить браузер"
            className="rounded p-0.5 transition-colors"
            style={{ color: 'var(--color-text-tertiary)' }}>
            <X size={12} />
          </button>
        )}
      </div>

      {/* Предупреждение о неподтверждённом домене - то, что должен видеть человек. */}
      {domain && !domain.verified && !closed && (
        <div className="flex items-start gap-2 border-b px-2.5 py-1.5 text-[11px] leading-4"
          style={{
            borderColor: 'var(--color-border)',
            background: 'rgba(234,179,8,0.10)',
            color: '#eab308',
          }}>
          <ShieldAlert size={12} className="mt-0.5 shrink-0" />
          <span>
            {domain.impersonates
              ? `Похоже на подделку. Настоящий ${domain.impersonates} — ${domain.official_domain}, а не ${domain.domain}.`
              : `Домен ${domain.domain} не в списке проверенных. Официальность не подтверждена — не вводи сюда личные данные.`}
          </span>
        </div>
      )}

      <div className="openportal-browser-frame relative bg-black" style={{ aspectRatio: `${ratio}` }}>
        <img
          ref={imgRef}
          alt="Браузер ИИ"
          // Источник ставится в ref из обработчика события. Начальное
          // значение - прозрачный пиксель: пустой src заставил бы браузер
          // перезапросить адрес самой страницы лаунчера.
          src={BLANK}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ imageRendering: 'auto' }}
        />
        {!closed && seq === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ background: 'rgba(0,0,0,.56)', color: 'var(--color-text-secondary)' }}>
            <Loader2 size={18} className="animate-spin" style={{ color: 'var(--grad-glow)' }} />
            <span className="text-[11px]">Подключаем браузер агента…</span>
          </div>
        )}
        {cursor.visible && (
          <MousePointer2
            key={seq}
            size={22}
            className="pointer-events-none absolute -translate-x-[2px] -translate-y-[2px]"
            style={{
              left: `${Math.max(0, Math.min(100, (cursor.x / fw) * 100))}%`,
              top: `${Math.max(0, Math.min(100, (cursor.y / fh) * 100))}%`,
              color: '#22c55e',
              filter: 'drop-shadow(0 0 2px #000)',
            }}
          />
        )}
        {closed && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px]"
            style={{ background: 'rgba(0,0,0,0.7)', color: 'var(--color-text-secondary)' }}>
            Браузер остановлен
          </div>
        )}
      </div>

      <p className="px-2.5 py-1.5 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
        Окна на экране нет — браузер работает скрыто, файлы скачиваются только в кеш лаунчера.
        {' '}Закрой карточку, чтобы остановить.
      </p>
    </div>
  );
}
