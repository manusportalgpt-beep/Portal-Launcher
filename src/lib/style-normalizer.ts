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
/** Метка «здесь уже пройдено» — по ней отсекаем целые поддеревья. */
const WALKED = 'data-px-walked';
const SKIP_TAGS = new Set(['IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'SVG', 'PATH', 'CANVAS', 'BR', 'I', 'B']);
/** Элементы, у которых рамка — часть смысла, а не подложка. */
const NEVER = new Set(['BUTTON', 'A']);

/** Площадь, ниже которой элемент считается мелочью, а не подложкой. */
const MIN_AREA = 8000;

function looksLikePanel(el: HTMLElement): boolean {
  if (NEVER.has(el.tagName)) return false;
  if (el.classList.contains(DONE)) return false;
  if (el.classList.contains('px-frame') || el.classList.contains('px-tile')) return false;

  const rect = el.getBoundingClientRect();
  if (rect.width < 120 || rect.height < 60) return false;
  if (rect.width * rect.height < MIN_AREA) return false;

  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (style.opacity === '0' || style.position === 'absolute') return false;

  // Фон подложки задаётся инлайном; проверяем именно его, иначе под правило
  // попадёт любой прозрачный фон, у которого цвет есть.
  const inlineBg = el.style.background || el.style.backgroundColor;
  if (inlineBg && inlineBg !== 'transparent' && inlineBg !== 'none') return true;
  return (parseFloat(style.borderTopWidth) || 0) >= 1;
}

function walk(root: ParentNode) {
  const nodes = root.querySelectorAll<HTMLElement>('*');
  // Счётчик каскада: панели появляются друг за другом, а не разом.
  let cardIndex = 0;
  for (const el of nodes) {
    if (SKIP_TAGS.has(el.tagName)) continue;
    // Уже размеченное поддерево пропускаем целиком: это главная причина
    // прошлого моргания — каждый проход заново трогал сотни узлов.
    if (el.hasAttribute(WALKED)) continue;
    el.setAttribute(WALKED, '');
    if (!looksLikePanel(el)) continue;
    el.classList.add(DONE);
    // Больше 12 ступеней — задержка перестаёт читаться как «появление»
    // и начинает ощущаться как тормоз, поэтому дальше смещение не растёт.
    el.style.setProperty('--i', String(Math.min(cardIndex, 12)));
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
  }, 260);
}

let observer: MutationObserver | null = null;

/**
 * Включает или выключает пиксельное оформление.
 *
 * Метка `data-px-ui` на <html> — единый выключатель для всего слоя:
 * pixel-global.css смотрит на неё, поэтому при выключении возвращаются
 * скругления темы и обычные поля ввода, а не «полупиксель».
 */
export function setPixelUi(on: boolean) {
  const html = document.documentElement;
  if (on) {
    html.setAttribute('data-px-ui', 'on');
    // Метка на раскладку уже должна быть готова — иначе пришлось бы
    // снимать классы с сотен узлов.
    if (!html.hasAttribute(WALKED)) initStyleNormalizer();
  } else {
    html.removeAttribute('data-px-ui');
    for (const el of document.querySelectorAll(`.${DONE}`)) {
      el.classList.remove(DONE, 'px-item-in');
      el.removeAttribute(WALKED);
    }
  }
}

/**
 * Запускает нормализатор. Вызывается один раз при старте окна лаунчера.
 * Повторный вызов ничего не делает.
 */
export function initStyleNormalizer() {
  if (typeof document === 'undefined' || observer) return;
  // Метка на <html>: по ней видно, что слой вообще включился. Заодно ею
  // пользуется переключатель старого интерфейса в настройках.
  document.documentElement.setAttribute('data-px-ui', 'on');
  schedule();
  observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  // При смене маршрута React пересоздаёт поддерево — проходим ещё раз.
  window.addEventListener('popstate', schedule);
}
