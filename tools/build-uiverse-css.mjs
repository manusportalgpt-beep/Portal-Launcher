// Скрипт сборки CSS из скачанных компонентов uiverse.
//
// Зачем: файлы uiverse используют «голые» селекторы (`button { }`, `label { }`),
// которые в большом приложении перекрасили бы и сломали все кнопки и поля
// ввода. Поэтому каждый кусок CSS заворачивается в свой скоуп `.uiv-<id>`.
//
// Цвета также нормализуются под палитру: пользователь просил чёрно-красный
// градиент везде, и чтобы смена палитры меняла все компоненты сразу. Поэтому
// вместо конкретных hex ставится CSS-переменная палитры.
//
// Запуск: node tools/build-uiverse-css.mjs <dir с html> <выходной css>

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [, , srcDir, outFile, regFile] = process.argv;
if (!srcDir || !outFile || !regFile) {
  console.error('usage: node build-uiverse-css.mjs <srcDir> <outCss> <outRegistry.ts>');
  process.exit(1);
}

/** Убирает вложенные @media/@supports и переносит их селекторы в общий скоуп. */
function splitAtRules(css) {
  const blocks = [];
  let guard = '';
  let i = 0;
  let buf = '';
  while (i < css.length) {
    if (css.startsWith('@media', i) || css.startsWith('@supports', i)) {
      const open = css.indexOf('{', i);
      if (open === -1) { buf += css[i++]; continue; }
      const cond = css.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      buf += splitAtRules(css.slice(open + 1, j - 1)).map(b => `@${cond}{${b}}`).join('\n');
      i = j;
    } else {
      buf += css[i++];
    }
  }
  void guard;
  if (buf.trim()) blocks.push(buf.trim());
  return blocks;
}

/**
 * Разбивает CSS на пары [селектор, тело] верхнего уровня.
 * Вложенные at-rules внутри тела остаются внутри тела как есть.
 */
function parseRules(body) {
  const out = [];
  let sel = '';
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf('{', i);
    if (open === -1) break;
    sel = body.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < body.length && depth > 0) {
      if (body[j] === '{') depth++;
      else if (body[j] === '}') depth--;
      j++;
    }
    const inner = body.slice(open + 1, j - 1);
    if (sel) out.push([sel, inner]);
    i = j;
  }
  return out;
}

/** Нормализует цвет под палитру. */
function recolor(css) {
  return css.replace(/#[0-9a-fA-F]{3,8}\b/g, hex => {
    const h = hex.slice(1);
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
    const n = Number.parseInt(full, 16);
    if (Number.isNaN(n)) return hex;
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // почти чёрный -> начало градиента
    if (max <= 26) return 'var(--grad-from)';
    // белый/светлый фон -> поверхность темы
    if (min >= 232) return 'var(--uiv-surface)';
    // выраженный красный (или любой доминирующий тёплый) -> конец градиента
    if (r > g + 40 && r > b + 40) return 'var(--grad-to)';
    // остальное насыщенное -> свечение палитры
    if (max - min > 60) return 'var(--grad-glow)';
    return hex;
  });
}

function adaptProjectColors(css) {
  return css
    .replace(/#3d3a4e/gi, 'var(--color-surface-2)')
    .replace(/rgba\(150,\s*93,\s*233,\s*1\)/gi, 'var(--grad-from)')
    .replace(/rgba\(99,\s*88,\s*238,\s*1\)/gi, 'var(--grad-to)');
}

function scopeSelectors(css, scope) {
  const rules = parseRules(css);
  const parts = [];
  for (const [selector, body] of rules) {
    // keyframes и уже скоупленные правила не трогаем
    if (/^@/.test(selector)) continue;
    const scoped = selector
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => {
        if (s === ':root' || s === 'html' || s === 'body') return scope;
        if (s.startsWith('@')) return s;
        return `${scope} ${s}`;
      })
      .join(', ');
    parts.push(`${scoped}{${adaptProjectColors(recolor(body))}}`);
  }
  return parts.join('\n');
}

/**
 * Переименовывает @keyframes и все обращения к ним, чтобы имена из разных
 * компонентов не сталкивались (`load`, `slide`, `spinner` встречаются у
 * многих). Возвращает [css без keyframes, переименованные keyframes].
 */
function renameKeyframes(css, scope) {
  const re = /@(?:-\w+-)?keyframes\s+([\w-]+)/g;
  const names = new Set();
  let m;
  while ((m = re.exec(css)) !== null) names.add(m[1]);

  let body = css;
  for (const name of names) {
    const renamed = `${scope}-${name}`.replace(/[^a-zA-Z0-9_-]/g, '-');
    body = body.replace(new RegExp(`\\b${name}\\b`, 'g'), renamed);
  }

  // вырезаем сами блоки keyframes — они попадут в общий список без скоупа
  const blocks = [];
  const blockRe = /@(?:-\w+-)?keyframes\s+([\w-]+)\s*\{/g;
  while ((m = blockRe.exec(body)) !== null) {
    let depth = 1;
    let j = blockRe.lastIndex;
    while (j < body.length && depth > 0) {
      if (body[j] === '{') depth++;
      else if (body[j] === '}') depth--;
      j++;
    }
    blocks.push(`@keyframes ${m[1]}{${body.slice(blockRe.lastIndex, j - 1)}}`);
    body = body.slice(0, m.index) + body.slice(j);
  }
  return [body, blocks];
}

const files = readdirSync(srcDir).filter(f => f.endsWith('.html'));
const chunks = [];
const kfAll = [];
const registry = {};

for (const file of files) {
  const raw = readFileSync(join(srcDir, file), 'utf8');
  const styleMatch = raw.match(/<style>([\s\S]*?)<\/style>/);
  const base = file.replace('__', '_').replace(/\.html$/, '');
  const scope = `.uiv-${base.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  // Разметка сохраняется как есть: переписывать 23 компонента в JSX руками
  // значило бы испортить их (SVG-пути, вложенные label'ы). В React она
  // подставляется через inert-HTML, поэтому работает ровно как в оригинале.
  const html = raw
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  registry[base] = { scope: scope.slice(1), html };

  // Четыре компонента (тосты, сайдбар, тултип) сделаны на Tailwind-утилитах
  // и своего <style> не имеют — им скоуп не нужен, стили уже в проекте.
  if (!styleMatch) continue;
  let css = styleMatch[1];

  // Авторство сохраняем в заголовке блока, а сами комментарии вырезаем:
  // они содержат запятые («Tags: button, ...»), из-за чего разбор селекторов
  // по запятой давал мусор и unscoped-правила вроде голого `button{}`.
  const author = (css.match(/From Uiverse\.io by\s+([^\s*—-]+)/) || [])[1] || '';
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');

  const kf = renameKeyframes(css, scope);
  const body = kf[0];
  chunks.push(`/* ===== ${file.replace('__', '/')}${author ? ` — ${author}` : ''} ===== */`);
  chunks.push(scope + '{ --uiv-surface: var(--color-surface); }');
  chunks.push(scope + ' *{ box-sizing: border-box; }');
  kfAll.push(...kf[1]);
  chunks.push(scopeSelectors(body, scope));
}

const header = `/* СГЕНЕРИРОВАНО tools/build-uiverse-css.mjs — не править руками.
   Компоненты uiverse.io (uiverse-io/galaxy), CSS заскоупин и перекрашен
   под палитру лаунчера. */
.uiv-stage { position: relative; isolation: isolate; }
`;

// Слой совместимости идёт ПОСЛЕ правил компонентов: specificity у него
// такой же, как у оригинала, поэтому порядок решает.
const compat = `/* ---------------------------------------------------------------------------
   Совместимость с размерами лаунчера.

   Компоненты uiverse рассчитаны на отдельную страницу и жёстко задают
   height: 3rem, padding: 0 2rem, font-size: 18px. Внутри карточки мода
   такая кнопка выше соседних иконок, а её ::before (width:100%; height:inherit)
   не изолирован и залипает поверх них. Поэтому всем кнопкам внутри обёртки
   задаётся компактный размер, а обёртка изолируется.
   --------------------------------------------------------------------------- */
[class^="uiv-"] { position: relative; isolation: isolate; max-width: 100%; }
[class^="uiv-"] button,
[class^="uiv-"] .button,
[class^="uiv-"] .cssbuttons-io,
[class^="uiv-"] .brutalist-button {
  font-size: 13px !important;
  line-height: 1.25 !important;
  height: auto !important;
  min-height: 30px !important;
  max-width: 100%;
  padding: 0.4rem 0.9rem !important;
  box-sizing: border-box !important;
}
[class^="uiv-"] .button-content,
[class^="uiv-"] .button-text,
[class^="uiv-"] .cssbuttons-io > span { padding: 0 !important; font-size: inherit !important; }
[class^="uiv-"] .brutalist-button { gap: 0.5rem !important; }
[class^="uiv-"] .ms-logo-square { width: 0.75rem !important; height: 0.75rem !important; }

/* ---------------------------------------------------------------------------
   Карточка автора (funny-cat-84).

   В оригинале это каркас: имя, ник и описание нарисованы серыми
   прямоугольниками-заглушками (width: 60/100/180px, background: #414141).
   Пользователь попросил вернуть иконку, ник и описание, поэтому заглушки
   заменяются обычным текстом, а карточка растягивается по содержимому
   вместо фиксированных 190x254.
   --------------------------------------------------------------------------- */
.uiv-author-card { display: block; }
.uiv-author-card .card {
  width: 100%;
  height: auto;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  box-shadow: none;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.uiv-author-card .imge {
  height: auto;
  background: transparent;
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 2px 12px;
  align-items: center;
}
.uiv-author-card .imge .Usericon {
  grid-row: 1 / 3;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  transform: none;
  background: var(--color-surface-2) center/cover no-repeat;
}
.uiv-author-card .imge .UserName,
.uiv-author-card .imge .Id {
  background: none;
  border: 0;
  width: auto;
  height: auto;
  transform: none;
  overflow-wrap: anywhere;
}
.uiv-author-card .imge .UserName {
  font-size: 15px;
  font-weight: 800;
  color: var(--color-text);
}
.uiv-author-card .imge .Id {
  font-size: 12px;
  color: var(--color-text-secondary);
}
.uiv-author-card .Description {
  width: auto;
  height: auto;
  min-height: 0;
  transform: none;
  background: var(--color-surface-2);
  border: 0;
  padding: 10px;
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
`;

writeFileSync(outFile, header + kfAll.join('\n') + '\n\n' + chunks.join('\n\n') + '\n\n' + compat, 'utf8');

// Реестр разметки для React-обёрток.
const entries = Object.entries(registry)
  .map(([k, v]) => `  ${JSON.stringify(k)}: {\n    scope: ${JSON.stringify(v.scope)},\n    html: ${JSON.stringify(v.html)},\n  },`)
  .join('\n');
const ts = `/* СГЕНЕРИРОВАНО tools/build-uiverse-css.mjs — не править руками.
   Оригинальная разметка компонентов uiverse.io (uiverse-io/galaxy). */

export interface UivEntry {
  /** Класс-скоуп, под которым живут стили компонента. */
  scope: string;
  html: string;
}

export const UIV: Record<string, UivEntry> = {
${entries}
};

export const UIV_IDS = Object.keys(UIV);
`;
writeFileSync(regFile, ts, 'utf8');

console.log(`files: ${files.length}, keyframes: ${kfAll.length}, registry: ${Object.keys(registry).length}`);
