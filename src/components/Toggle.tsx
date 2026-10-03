// Переключатель в едином стиле OreUI: прямые углы, серый квадратный бегунок.
// Раньше каждая страница рисовала свой вариант — выглядело по-разному и бегунок
// вылезал за рамку. Один компонент = один вид во всём лаунчере.
//
// decorative: переключатель не кликает сам, а рисуется как картинка.
// Нужен, когда ползунок лежит ВНУТРИ кнопки ("Snapshot-версии"): вложенный
// <button> браузер не считает кликабельным, и нажатие на бегунок не срабатывало.
export function Toggle({ value, onChange, title, className = '', decorative = false }: {
  value: boolean;
  onChange: (v: boolean) => void;
  title?: string;
  className?: string;
  decorative?: boolean;
}) {
  const body = (
    <span
      role={decorative ? undefined : 'switch'}
      aria-checked={decorative ? undefined : value}
      aria-hidden={decorative ? 'true' : undefined}
      title={decorative ? undefined : title}
      onClick={decorative ? undefined : () => onChange(!value)}
      className={`relative block shrink-0 transition-colors ${className}`}
      style={{
        width: 38,
        height: 20,
        borderRadius: 999,
        overflow: 'hidden',
        // Градиент палитры вместо сплошной заливки: пункт «всё кругленькое,
        // чёрный → красный» должен работать и на переключателях.
        background: value ? 'var(--grad)' : 'var(--color-surface-2)',
        border: `1px solid ${value ? 'var(--grad-glow)' : 'var(--color-border)'}`,
      }}
    >
      <span
        className="absolute transition-[left]"
        style={{
          width: 12,
          height: 12,
          borderRadius: 999,
          background: 'var(--color-text)',
          top: '50%',
          transform: 'translateY(-50%)',
          left: value ? 23 : 3,
          boxShadow: 'none',
        }}
      />
    </span>
  );

  if (decorative) return body;
  return (
    <button type="button" title={title} onClick={() => onChange(!value)} className="shrink-0">
      {body}
    </button>
  );
}

/** Переключатель с подписью — для форм. */
export function ToggleRow({ value, onChange, label, title }: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  title?: string;
}) {
  return (
    <span className="flex shrink-0 items-center gap-2">
      <Toggle value={value} onChange={onChange} title={title} />
      {label}
    </span>
  );
}
