/**
 * Заливка ползунков в стиле OreUI: зелёным (акцентом) только часть ДО
 * бегунка, после — серым.
 *
 * В WebKit нет псевдоэлемента «заполненной части» (в отличие от Firefox,
 * где работает ::-moz-range-progress), поэтому значение ползунка нужно
 * прокинуть в CSS. Модуль один раз навешивает делегированные слушатели на
 * document: любой input[type=range] получает --ore-range-pct, и трек рисуется
 * градиентом «акцент до значения, серый после».
 *
 * Экспортируется функция syncRangeFill для точечного обновления.
 */

const RANGE_SELECTOR = 'input[type="range"]';

function percentOf(input: HTMLInputElement): number {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const step = Number(input.step || 1);
  const value = Number(input.value || min);
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max === min) return 0;
  const span = max - min;
  return Math.min(100, Math.max(0, ((value - min) / span) * 100));
}

export function syncRangeFill(input: HTMLInputElement) {
  const pct = percentOf(input);
  input.style.setProperty('--ore-range-pct', `${pct}%`);
}

export function initRangeFill() {
  const sync = (target: EventTarget | null) => {
    if (target instanceof HTMLInputElement && target.matches(RANGE_SELECTOR)) syncRangeFill(target);
  };

  document.addEventListener('input', sync);
  document.addEventListener('change', sync);

  // Первичная заливка уже отрисованных ползунков + те, что появятся позже.
  const scan = () => {
    document.querySelectorAll<HTMLInputElement>(RANGE_SELECTOR).forEach(syncRangeFill);
  };
  scan();

  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => scan());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
}
