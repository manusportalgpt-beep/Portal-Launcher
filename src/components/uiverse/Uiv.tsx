import { useEffect, useMemo, useRef } from 'react';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { UIV, type UivEntry } from './registry';

/**
 * Обёртки над компонентами uiverse.io.
 *
 * Разметка хранится в registry.ts в исходном виде и подставляется через
 * dangerouslySetInnerHTML. Это сознательный выбор: 23 компонента содержат
 * SVG-пути, вложенные label'ы и псевдоэлементы, и переписывание их в JSX
 * почти гарантированно ломает анимации. Разметка статична, приходит из
 * собственного локального файла, а не из сети — инъекции здесь нет.
 *
 * Побочный эффект: React не видит внутренние элементы. Поэтому всё, что
 * должно меняться (подпись кнопки, checked у тумблера), правится через ref
 * в useEffect — см. applyLabel/applyChecked.
 */

export type UivId = keyof typeof UIV | string;

function entryOf(id: UivId): UivEntry {
  const found = UIV[id];
  if (!found) throw new Error(`uiverse: нет компонента "${id}"`);
  return found;
}

/** Базовый рендер компонента по его id. */
export function Uiv({
  id,
  className,
  style,
  title,
}: {
  id: UivId;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}) {
  const { scope, html } = entryOf(id);
  return (
    <span
      className={`uiv-stage ${scope}${className ? ` ${className}` : ''}`}
      style={style}
      title={title}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Меняет текст в первом текстовом узле (обычно <span> с подписью). */
function applyLabel(root: HTMLElement | null, label: string | undefined) {
  if (!root || label === undefined) return;
  const target =
    root.querySelector('span') ??
    root.querySelector('button') ??
    root.querySelector('a');
  if (!target) return;
  // SVG и вложенные элементы оставляем, заменяем только прямые текстовые узлы.
  const directText = Array.from(target.childNodes).filter(node => node.nodeType === Node.TEXT_NODE);
  if (directText.length > 0) {
    directText.forEach(node => node.remove());
    target.appendChild(document.createTextNode(label));
  } else if (target.children.length === 0) {
    target.textContent = label;
  } else {
    target.appendChild(document.createTextNode(label));
  }
}

function applyChecked(root: HTMLElement | null, checked: boolean | undefined) {
  if (!root || checked === undefined) return;
  const input = root.querySelector('input');
  if (input) input.checked = checked;
}

/* ---------------------------------------------------------------------------
   Кнопки
   --------------------------------------------------------------------------- */

interface ButtonProps {
  label?: string;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  title?: string;
  disabled?: boolean;
}

/** Постоянная кнопка лаунчера: чёрно-красный градиент, заливка на hover. */
export function GradientButton({ label, onClick, className, title, disabled }: ButtonProps) {
  const id = 'Buttons_BHARGAVPATEL1244_great-catfish-18';
  const { scope, html } = entryOf(id);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => { applyLabel(ref.current, label); }, [label]);
  return (
    <span
      ref={ref}
      className={`uiv-stage ${scope}${className ? ` ${className}` : ''}`}
      title={title}
      style={{ opacity: disabled ? 0.45 : 1, cursor: disabled ? 'not-allowed' : 'pointer', display: 'inline-block' }}
      onClick={disabled ? undefined : onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Кнопка установки модификации. */
export function InstallButton({ label = 'Установить', ...rest }: ButtonProps) {
  const id = 'Buttons_Madflows_stale-baboon-45';
  const { scope, html } = entryOf(id);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => { applyLabel(ref.current, label); }, [label]);
  return (
    <span
      ref={ref}
      className={`uiv-stage ${scope}`}
      style={{ display: 'inline-block' }}
      onClick={rest.disabled ? undefined : rest.onClick}
      title={rest.title}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Кнопка с иконкой (используется для ссылки на проект в «О лаунчере»). */
export function IconButton({ id, label, href, onClick }: { id: UivId } & ButtonProps & { href?: string }) {
  const { scope, html } = entryOf(id);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => { applyLabel(ref.current, label); }, [label]);
  useEffect(() => {
    const a = ref.current?.querySelector('a');
    if (a && href) a.href = href;
  }, [href]);
  const handleClick = (event: React.MouseEvent) => {
    onClick?.(event);
    if (event.defaultPrevented || !href) return;
    const anchor = ref.current?.querySelector<HTMLAnchorElement>('a');
    if (!anchor) void shellOpen(href).catch(() => window.open(href, '_blank', 'noopener,noreferrer'));
  };
  return (
    <span
      ref={ref}
      className={`uiv-stage ${scope}`}
      style={{ display: 'inline-block' }}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Кнопка входа. Оригинал — «Get it from Microsoft» с фирменной сеткой,
 * поэтому вариант на ник/Ely.by просто меняет подписи и цвет заливки.
 */
export function LoginButton({
  provider = 'Microsoft',
  onClick,
}: {
  provider?: 'Microsoft' | 'Никнейм' | 'Ely.by';
  onClick?: () => void;
}) {
  const id = 'Buttons_0xnihilism_fast-cat-82';
  const { scope, html } = entryOf(id);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const spans = ref.current?.querySelectorAll('.button-text span');
    if (spans && spans.length >= 2) {
      spans[0].textContent = provider === 'Microsoft' ? 'Войти через' : 'Войти по';
      spans[1].textContent = provider;
    }
  }, [provider]);
  return (
    <span
      ref={ref}
      className={`uiv-stage ${scope}`}
      style={{ display: 'inline-block' }}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/* ---------------------------------------------------------------------------
   Тумблеры
   --------------------------------------------------------------------------- */

/** Переключатель темы (strong-squid): солнце/луна с облаками и звёздами. */
export function ThemeToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const id = 'Toggle-switches_Galahhad_strong-squid-82';
  const { scope, html } = entryOf(id);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    applyChecked(ref.current, checked);
    const input = ref.current?.querySelector<HTMLInputElement>('input');
    if (!input) return;
    const handleChange = () => onChange(input.checked);
    input.addEventListener('change', handleChange);
    return () => input.removeEventListener('change', handleChange);
  }, [checked, onChange]);
  return (
    <span
      ref={ref}
      className={`uiv-stage ${scope}`}
      style={{ display: 'inline-block' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Простой тумблер (spicy-hound) для переключателей в настройках. */
export function ToggleSwitch({
  id = 'opt',
  checked,
  onChange,
  className,
  title,
}: {
  id?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
  title?: string;
}) {
  const key = 'Toggle-switches_varoonrao_spicy-hound-14';
  const { scope, html } = entryOf(key);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    applyChecked(ref.current, checked);
    const input = ref.current?.querySelector<HTMLInputElement>('input');
    if (!input) return;
    input.id = `uiv-${id}`;
    const handleChange = () => onChange(input.checked);
    input.addEventListener('change', handleChange);
    return () => input.removeEventListener('change', handleChange);
  }, [checked, id, onChange]);
  return (
    <span
      ref={ref}
      className={`uiv-stage ${scope}${className ? ` ${className}` : ''}`}
      style={{ display: 'inline-block' }}
      title={title}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/* ---------------------------------------------------------------------------
   Загрузчики
   --------------------------------------------------------------------------- */

export const LOADER_IDS = [
  'loaders_bociKond_wise-bat-13',
  'loaders_Z4drus_polite-seahorse-77',
  'loaders_csemszepp_spotty-sloth-98',
  'loaders_mobinkakei_pretty-fireant-78',
  'loaders_Pradeepsaranbishnoi_chatty-bird-86',
  'loaders_Juanes200122_fluffy-lizard-32',
  'loaders_AqFox_silent-quail-21',
  'loaders_Yogeshawghad0477_angry-ladybug-53',
  'loaders_Satwinder04_witty-starfish-81',
  'loaders_Sourcesketch_strange-catfish-68',
  'loaders_csozidev_young-bat-70',
  'loaders_dylanharriscameron_ancient-falcon-18',
] as const;

export type LoaderId = (typeof LOADER_IDS)[number];

/**
 * Загрузчик. Размер задаётся в px: у uiverse компонентов жёстко зашиты
 * размеры, из-за чего в маленькой плашке они вылезали за края.
 */
export function Loader({
  variant,
  size = 32,
  label,
}: {
  variant: LoaderId;
  size?: number;
  label?: string;
}) {
  const { scope, html } = entryOf(variant);
  const box = useMemo(
    () => ({
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      overflow: 'hidden',
      flex: '0 0 auto',
    }),
    [size],
  );
  return (
    <span className="inline-flex items-center gap-2" style={box} title={label}>
      <span
        className={`uiv-stage ${scope}`}
        style={{ transform: `scale(${Math.max(0.35, size / 90)})`, transformOrigin: 'center' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {label ? <span className="text-[11px]">{label}</span> : null}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Карточки, тосты, сайдбар
   --------------------------------------------------------------------------- */

export function AuthorCard({
  name,
  handle,
  description,
  avatarUrl,
  onClose,
}: {
  name: string;
  handle: string;
  description?: string;
  avatarUrl?: string;
  onClose?: () => void;
}) {
  const id = 'Cards_1osm_funny-cat-84';
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const set = (sel: string, text: string) => {
      const el = root.querySelector(sel);
      if (el) el.textContent = text;
    };
    set('.UserName', name);
    set('.Id', handle);
    set('.Description', description ?? '');
    // Социальные сети в карточке не нужны — пункт 10 прямо это просил.
    root.querySelector('.social-media')?.remove();
    const icon = root.querySelector('.Usericon') as HTMLElement | null;
    if (avatarUrl && icon) {
      icon.style.backgroundImage = `url(${avatarUrl})`;
      icon.style.backgroundSize = 'cover';
      icon.style.backgroundPosition = 'center';
    }
  }, [name, handle, description, avatarUrl]);

  return <Uiv id={id} className="uiv-author-card" />;
}

/** Тост: heavy-cobra-18 — ошибка, wicked-chipmunk-81 — успех. */
export function Toast({
  kind = 'success',
  title,
  detail,
}: {
  kind?: 'success' | 'error';
  title: string;
  detail?: string;
}) {
  const id = kind === 'error'
    ? 'Cards_seyed-mohsen-mousavi_heavy-cobra-18'
    : 'Cards_seyed-mohsen-mousavi_wicked-chipmunk-81';
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // В оригинале два span'а: заголовок и подпись. Ищем их по порядку внутри
    // блока алерта, а не по всему контейнеру — иначе подпись попадала бы в SVG.
    const alert = root.querySelector('[class*="-alert"]') ?? root;
    const spans = Array.from(alert.querySelectorAll('span')).filter(
      s => !(s instanceof SVGElement) && !s.querySelector('svg'),
    );
    if (spans[0]) spans[0].textContent = title;
    if (spans[1]) spans[1].textContent = detail ?? '';
  }, [title, detail]);
  return (
    <span
      ref={ref}
      className="block w-full"
      dangerouslySetInnerHTML={{ __html: entryOf(id).html }}
    />
  );
}

/** Всплывающая подсказка при наведении (quick-zebra) — для структуры папок. */
export function HoverHint({ label, children }: { label: string; children: React.ReactNode }) {
  const id = 'Tooltips_themrsami_quick-zebra-71';
  const { scope, html } = entryOf(id);
  return (
    <span className={`uiv-stage ${scope} relative inline-block`} title={label}>
      <span
        dangerouslySetInnerHTML={{ __html: html }}
        style={{ display: 'inline-block' }}
      />
      {children}
    </span>
  );
}

/** Эффект генерации: wicked-elephant с сохранением компактного размера лаунчера. */
export function GenerationLoader({ label = 'OpenPortal работает' }: { label?: string }) {
  return (
    <span className="uiv-generation-loader loader-wrapper" role="status" aria-live="polite" aria-label={label}>
      <span className="loader" aria-hidden="true" />
      <span className="loader-letters" aria-hidden="true">
        {label.split('').map((letter, index) => (
          <span key={`${letter}-${index}`} className="loader-letter" style={{ animationDelay: `${0.1 + index * 0.105}s` }}>
            {letter === ' ' ? '\u00a0' : letter}
          </span>
        ))}
      </span>
    </span>
  );
}
