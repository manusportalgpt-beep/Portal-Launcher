import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Граница ошибок.
 *
 * Без неё любая ошибка в одном компоненте гасила всё дерево React: игрок
 * видел чёрный экран без единого слова о причине. Здесь вместо этого —
 * понятное сообщение и кнопка копирования: отчёт о падении можно сразу
 * приложить к обращению.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Интерфейс лаунчера упал:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div
          className="w-full max-w-[560px] p-5"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: 'var(--color-primary)' }}>
            Интерфейс не запустился
          </p>
          <h1 style={{ color: 'var(--color-text)', fontSize: 20, fontWeight: 800, margin: '8px 0 6px' }}>
            Случилась ошибка на экране
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
            Лаунчер работает, но один из экранов не отрисовался. Текст ошибки — под
            кнопкой, его можно скопировать и приложить к отчёту.
          </p>
          <pre
            style={{
              margin: '14px 0 0', padding: 10, maxHeight: 180, overflow: 'auto',
              background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)',
              fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
            {error.message || String(error)}
          </pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              type="button"
              onClick={() => { void navigator.clipboard?.writeText(`${error.message}\n${error.stack ?? ''}`); }}
              style={{
                padding: '9px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                background: 'var(--color-primary)', color: 'var(--color-primary-text)', border: 0,
              }}>
              Скопировать ошибку
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '9px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                background: 'var(--color-surface-2)', color: 'var(--color-text)', border: 0,
              }}>
              Перезапустить окно
            </button>
          </div>
        </div>
      </div>
    );
  }
}
