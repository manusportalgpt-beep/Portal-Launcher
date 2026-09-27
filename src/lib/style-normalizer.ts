/**
 * Нормализатор оформления.
 *
 * Задача: переоформить ВСЕ окна в пиксельный стиль, не переписывая каждую
 * страницу. Разметка собрана на инлайн-стилях, поэтому в CSS до подложек
 * не добраться: инлайн-фон перебивает любое правило без !important.
 *
 * Решение: один проход по DOM, который находит элементы-подложки (есть
 * рамка или своя заливка, площадь достаточная) и вешает на них класс
 * `px-card`. Дальше стиль берут на себя слои из `pixel-ui.css`.
 *
 * Почему это безопасно:
 *   - отбор строгий: не <img>/<input>/<svg>, не кнопки и не ссылки,
 *     площадь от 8000px², есть рамка толщиной от 1px;
 *   - каждый элемент обрабатывается один раз (WeakSet), повторных проходов
 *     по уже размеченным узлам нет;
 *   - MutationObserver срабатывает по debounce, а не на каждое изменение.
 *
 * Уже размеченные вручную элементы (px-card, px-frame, px-tile, px-btn)
 * нормализатор не трогает.
 */

const DONE = 'px-card';
const SKIP_TAGS = new Set(['IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'SVG', 'PATH', 'CANVAS', 'BR', 'I', 'B']);
/** Элементы, у которых рамка — часть смысла, а не подложка. */
const NEVER = new Set(['BUTTON', 'A']);

/** Площадь, ниже которой элемент считается мелочью, а не подложкой. */
const MIN_AREA = 8000;

const seen = new WeakSet<Element>();

function looksLikePanel(el: HTMLElement): boolean {
  if (NEVER.has(el.tagName)) return false;
  if (el.classList.contains(DONE)) return false;
  if (el.classList.contains('px-frame') || el.classList.contains('px-tile')) return false;

  const rect = el.getBoundingClientRect();
  if (rect.width < 120 || rect.height < 60) return false;
  if (rect.width * rect.height < MIN_AREA) return false;

  const style = getComputedStyle(el);
  // Только видимые и не схлопнутые в невидимость слои.
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (style.opacity === '0' || style.position === 'absolute') return false;

  const bw = parseFloat(style.borderTopWidth) || 0;
  const hasBorder = bw >= 1;
  const hasBg = style.backgroundColor !== 'rgba(0, 0, 0, 0)'
    && style.backgroundColor !== 'transparent';
  // Фон подложки задаётся инлайном; проверяем именно его, иначе под правило
  // попадёт любой про прозрачный фон, у которого цвет есть.
  const inlineBg = el.style.background || el.style.backgroundColor;
  const hasInlinePanelBg = Boolean(inlineBg) && inlineBg !== 'transparent' && inlineBg !== 'none';

  return hasBorder || hasInlinePanelBg;
}

function walk(root: ParentNode) {
  const nodes = root.querySelectorAll<HTMLElement>('*');
  // Счётчик каскада: панели появляются друг за другом, а не разом.
  let cardIndex = 0;
  for (const el of nodes) {
    if (seen.has(el) || SKIP_TAGS.has(el.tagName)) continue;
    seen.add(el);
    if (!looksLikePanel(el)) continue;
    el.classList.add(DONE);
    // Больше 12 ступенек — задержка перестаёт читаться как «появление»
    // и начинает ощущаться как тормоз, поэтому дальше смещение не растёт.
    const step = Math.min(cardIndex, 12);
    el.style.setProperty('--i', String(step));
    el.classList.add('px-item-in');
    cardIndex += 1;
  }
}

let scheduled = 0;
function schedule() {
  if (scheduled) return;
  scheduled = window.setTimeout(() => {
    scheduled = 0;
    walk(document.body);
  }, 120);
}

let observer: MutationObserver | null = null;

/**
 * Запускает нормализатор. Вызывается один раз при старте окна лаунчера.
 * Повторный вызов ничего не делает.
 */
export function initStyleNormalizer() {
  if (typeof document === 'undefined' || observer) return;
  schedule();
  observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  // При смене маршрута React пересоздаёт поддерево — проходим ещё раз.
  window.addEventListener('popstate', schedule);
}
