import { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Элементы «объёмной рамки» — наш собственный набор для пиксельного меню.
 *
 * Логика живёт в `pixel-ui.css`, здесь только разметка и типы. Компоненты
 * принимают обыщие className/style, поэтому их можно ставить в любом месте
 * лаунчера, не ломая текущую тему.
 */

export function PixelFrame({ children, className = '', style, ...rest }: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-frame ${className}`} style={style} {...rest}>
      {children}
    </div>
  );
}

type PixelButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary — акцентная кнопка, quiet — спокойная, omit variant — обычная. */
  variant?: 'primary' | 'quiet' | 'plain';
  /** Иконка слева от подписи. */
  icon?: ReactNode;
};

export function PixelButton({ variant = 'plain', icon, children, className = '', style, ...rest }: PixelButtonProps) {
  const variantClass = variant === 'primary'
    ? 'px-btn-primary'
    : variant === 'quiet' ? 'px-btn-quiet' : '';
  return (
    <button type="button" className={`px-btn ${variantClass} ${className}`} style={style} {...rest}>
      {icon}
      {children}
    </button>
  );
}

/** Вкладки в объёмной рамке: активная поднята вверх. */
export function PixelTabs<T extends string>({ value, options, onChange, className = '' }: {
  value: T;
  options: Array<{ id: T; label: ReactNode; title?: string }>;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={`px-tabs ${className}`} role="tablist">
      {options.map(opt => (
        <button
          key={opt.id}
          type="button"
          role="tab"
          aria-selected={value === opt.id}
          title={opt.title}
          onClick={() => onChange(opt.id)}
          className="px-tab px-3 py-1.5 text-[11px] uppercase tracking-wide">
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Иконка сборки: изометрический куб, собранный из трёх граней.
 *
 * Своя отрисовка вместо текстур предметов Minecraft — у нас должен быть свой
 * визуальный язык. Цвет граней задаётся загрузчиком, верхняя грань светлее.
 */
export function BlockIcon({ loader, size = 40 }: { loader: string; size?: number }) {
  const palette: Record<string, string> = {
    fabric: '#B9A489',
    quilt: '#7C6BA8',
    forge: '#4A5560',
    neoforge: '#B06A3B',
    vanilla: '#5FA85C',
  };
  const base = palette[loader?.toLowerCase()] ?? '#5A6270';
  return (
    <span
      className="px-block shrink-0"
      style={{ width: size, height: size }}
      aria-hidden
      title={loader}>
      <span className="px-block-top" style={{ background: `color-mix(in srgb, ${base} 82%, #fff 18%)` }} />
      <span className="px-block-left" style={{ background: `color-mix(in srgb, ${base} 78%, #000 22%)` }} />
      <span className="px-block-right" style={{ background: base }} />
    </span>
  );
}

/** Всплывающее уведомление в правом нижнем углу. */
export function PixelToast({ title, children, onClose }: {
  title?: string;
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="px-frame flex items-start gap-3 px-3 py-2.5" style={{ minWidth: 220 }}>
      <div className="min-w-0 flex-1">
        {title && (
          <p className="text-[9px] font-black uppercase tracking-wider" style={{ color: 'var(--color-warning)' }}>
            {title}
          </p>
        )}
        <div className="text-[12px] font-bold" style={{ color: 'var(--color-text)' }}>{children}</div>
      </div>
      {onClose && (
        <button type="button" onClick={onClose} className="shrink-0 text-[11px] font-black"
          style={{ color: 'var(--color-text-tertiary)' }} aria-label="Закрыть">
          ×
        </button>
      )}
    </div>
  );
}
