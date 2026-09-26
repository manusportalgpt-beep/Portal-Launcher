// Переключатель в едином стиле OreUI: прямые углы, серый квадратный бегунок.
// Раньше каждая страница рисовала свой вариант — выглядело по-разному и бегунок
// вылезал за рамку. Один компонент = один вид во всём лаунчере.
export function Toggle({ value, onChange, title, className = '' }: {
  value: boolean;
  onChange: (v: boolean) => void;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      title={title}
      onClick={() => onChange(!value)}
      className={`relative shrink-0 transition-colors ${className}`}
      style={{
        width: 38,
        height: 20,
        borderRadius: 2,
        overflow: 'hidden',
        background: value ? 'var(--color-primary)' : 'var(--color-surface-2)',
        border: `1px solid ${value ? 'var(--color-primary)' : 'var(--color-border)'}`,
      }}
    >
      <span
        className="absolute transition-[left]"
        style={{
          width: 12,
          height: 12,
          borderRadius: 1,
          background: 'var(--color-text)',
          top: '50%',
          transform: 'translateY(-50%)',
          left: value ? 23 : 3,
          boxShadow: 'none',
        }}
      />
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
