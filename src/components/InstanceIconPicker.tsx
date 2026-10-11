import { useState } from 'react';
import { instanceIconCatalog } from '@/lib/instance-icon-catalog';

interface InstanceIconPickerProps {
  onSelect: (src: string) => Promise<void>;
}

export function InstanceIconPicker({ onSelect }: InstanceIconPickerProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const choose = async (id: string, src: string) => {
    setLoadingId(id);
    setError('');
    try {
      await onSelect(src);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <section
      className="space-y-3 rounded-xl p-4"
      style={{ background: 'transparent', border: '1px solid var(--color-border)' }}
      aria-label="Стандартные иконки сборки"
    >
      <div>
        <h2 className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
          Стандартные иконки
        </h2>
        <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          Выберите изображение для этой сборки или загрузите своё выше.
        </p>
      </div>
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-7 lg:grid-cols-9">
        {instanceIconCatalog.map(({ id, name, src }) => (
          <button
            key={id}
            type="button"
            disabled={loadingId !== null}
            onClick={() => void choose(id, src)}
            aria-label={`Выбрать иконку: ${name}`}
            title={name}
            className="group relative flex aspect-square items-center justify-center overflow-hidden rounded-lg p-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60"
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              outlineColor: 'var(--color-primary)',
            }}
          >
            <img src={src} alt="" loading="lazy" className="h-full w-full object-contain" />
            {loadingId === id && (
              <span className="absolute inset-0 flex items-center justify-center" style={{ background: 'var(--color-bg)' }}>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" style={{ color: 'var(--color-primary)' }} />
              </span>
            )}
            {loadingId !== null && loadingId !== id && (
              <span className="pointer-events-none absolute inset-0 bg-[var(--color-bg)]/55" />
            )}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-xs" style={{ color: 'var(--color-error)' }}>
          {error}
        </p>
      )}
    </section>
  );
}
