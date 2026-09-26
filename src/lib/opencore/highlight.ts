// Подсветка синтаксиса без внешних зависимостей.
//
// Полноценный набор грамматик весит больше мегабайта, а в лаунчере нужен
// быстрый и предсказуемый вариант: строки, комментарии, числа, ключевые
// слова и типы. Этого хватает, чтобы код читался, а не был серой кашей.
//
// Раскраска идёт по токенам регулярным выражением за один проход на строку,
// поэтому длинные файлы не подвисают.

export type TokenKind =
  | 'plain' | 'comment' | 'string' | 'number' | 'keyword'
  | 'type' | 'function' | 'tag' | 'attr' | 'builtin';

const KEYWORDS: Record<string, true> = {};
for (const word of [
  // JS / TS
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'new', 'class', 'extends', 'implements',
  'interface', 'type', 'enum', 'import', 'export', 'from', 'default', 'async',
  'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in',
  'of', 'this', 'super', 'static', 'public', 'private', 'protected', 'readonly',
  'abstract', 'void', 'never', 'unknown', 'any', 'as', 'satisfies', 'keyof',
  'infer', 'is', 'namespace', 'declare', 'get', 'set', 'yield', 'delete',
  'true', 'false', 'null', 'undefined',
  // Java
  'public', 'private', 'protected', 'final', 'native', 'synchronized',
  'transient', 'volatile', 'strictfp', 'throws', 'instanceof', 'super',
  // C / GLSL
  'uniform', 'varying', 'attribute', 'layout', 'precision', 'highp', 'mediump',
  'lowp', 'in', 'out', 'inout', 'flat', 'smooth', 'centroid', 'discard',
  'struct', 'sampler2D', 'sampler3D', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3',
  'ivec4', 'mat2', 'mat3', 'mat4', 'float', 'int', 'bool', 'void', 'return',
  'break', 'continue', 'if', 'else', 'for', 'while', 'define', 'include',
  'ifdef', 'ifndef', 'endif', 'version', 'main',
  // Rust / SQL-ish
  'fn', 'let', 'mut', 'impl', 'pub', 'struct', 'trait', 'match', 'loop',
  'mod', 'use', 'crate', 'where', 'ref', 'move', 'Self', 'SELECT', 'FROM',
  'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'VALUES', 'SET',
]) KEYWORDS[word] = true;

const BUILTINS: Record<string, true> = {};
for (const word of [
  'console', 'document', 'window', 'Math', 'JSON', 'Object', 'Array', 'String',
  'Number', 'Boolean', 'Promise', 'Map', 'Set', 'Date', 'RegExp', 'Error',
  'require', 'module', 'exports', 'process', 'fetch', 'invoke', 'useState',
  'useEffect', 'useMemo', 'useCallback', 'useRef',
]) BUILTINS[word] = true;

const HTML_TAGS: Record<string, true> = {};
for (const tag of [
  'html', 'head', 'body', 'div', 'span', 'p', 'a', 'img', 'link', 'meta',
  'title', 'style', 'script', 'button', 'input', 'ul', 'ol', 'li', 'h1', 'h2',
  'h3', 'h4', 'table', 'tr', 'td', 'th', 'form', 'label', 'select', 'option',
]) HTML_TAGS[tag] = true;

export interface Token {
  kind: TokenKind;
  text: string;
}

// Один символ, а не «всё остальное»: иначе разделитель вроде «<!--» или
// «//» попадает внутрь plain-фрагмента и комментарий не распознаётся.
const TOKEN_RE = new RegExp([
  // 1) Комментарии: // … , /* … */, <!-- … -->
  '(?<comment>\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|<!--[\\s\\S]*?-->)',
  // 2) Строки: "…", '…', `…`
  '(?<string>"(?:\\\\.|[^"\\\\])*"?|\'(?:\\\\.|[^\'\\\\])*\'?|`(?:\\\\.|[^`\\\\])*`?)',
  // 3) Числа
  '(?<number>\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?[a-zA-Z%]*\\b)',
  // 4) Строка с `#`: директива, комментарий или обычный символ — решает язык
  '(?<hash>#[^\\n]*)',
  // 5) Имена: разбираем по контексту — функция, тип, тег, ключевое слово
  '(?<name>[A-Za-z_$][\\w$]*)',
  // 6) Остальное — строго по одному символу
  '(?<plain>.)',
].join('|'), 'g');

/**
 * Что означает `#` в конкретном языке.
 *
 * В GLSL и shell это директива препроцессора (`#version`, `#define`), в
 * Python, TOML и INI — комментарий, в остальных (JS, Java) это обычный
 * символ, например приватное поле `this.#x`.
 */
function hashKind(lang: string): 'keyword' | 'comment' | 'plain' {
  if (['glsl', 'sh', 'bash', 'ps1', 'powershell', 'cmake', 'make', 'glsl'].includes(lang)) return 'keyword';
  if (['py', 'toml', 'ini', 'yaml', 'yml', 'conf', 'cfg', 'properties', 'text', 'dockerfile'].includes(lang)) return 'comment';
  return 'plain';
}

/** Язык из markdown-заголовка ```html → 'html'. */
export function normalizeLang(lang: string | undefined): string {
  const l = (lang ?? '').trim().toLowerCase();
  if (['js', 'jsx', 'javascript', 'mjs', 'cjs'].includes(l)) return 'js';
  if (['ts', 'tsx', 'typescript'].includes(l)) return 'ts';
  if (['py', 'python'].includes(l)) return 'py';
  if (['rs', 'rust'].includes(l)) return 'rs';
  if (['glsl', 'vert', 'frag', 'shader', 'vsh', 'fsh'].includes(l)) return 'glsl';
  if (['htm', 'html', 'xml', 'svg'].includes(l)) return 'html';
  if (['json'].includes(l)) return 'json';
  if (['toml', 'ini', 'cfg'].includes(l)) return 'toml';
  if (['css', 'scss'].includes(l)) return 'css';
  if (['sh', 'bash', 'ps1', 'powershell'].includes(l)) return 'sh';
  if (['java'].includes(l)) return 'java';
  if (l === 'cs' || l === 'csharp') return 'cs';
  return l || 'text';
}

function isMarkup(lang: string): boolean {
  return lang === 'html' || lang === 'xml' || lang === 'svg';
}

function looksLikeType(word: string, prev: string): boolean {
  // Capitalized words в Java/C#/GLSL почти всегда типы.
  if (/^[A-Z]/.test(word) && word.length > 1) return true;
  // После префикса типов (new, extends, implements) тоже тип.
  return prev === 'new' || prev === 'extends' || prev === 'implements' || prev === 'class';
}

/** Разбирает строку кода в токены. */
export function tokenizeLine(line: string, lang: string): Token[] {
  const tokens: Token[] = [];
  let prevWord = '';
  let inBlockComment = false;

  // Многострочные /* … */ и <!-- … --> переносим между строками.
  const trimmedStart = line.trimStart();
  if (inBlockComment) {
    const end = trimmedStart.indexOf('*/');
    if (end < 0) return [{ kind: 'comment', text: line }];
    const comment = line.slice(0, line.length - trimmedStart.length + end + 2);
    const rest = line.slice(line.length - trimmedStart.length + end + 2);
    tokens.push({ kind: 'comment', text: comment });
    inBlockComment = false;
    return [...tokens, ...tokenizeLine(rest, lang)];
  }

  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(line)) !== null) {
    const groups = m.groups ?? {};
    const text = m[0];
    if (!text) continue;

    if (groups.comment !== undefined) {
      if (text.startsWith('/*') && !text.includes('*/')) inBlockComment = true;
      if (text.startsWith('<!--') && !text.includes('-->')) inBlockComment = true;
      tokens.push({ kind: 'comment', text });
      continue;
    }
    if (groups.string !== undefined) { tokens.push({ kind: 'string', text }); continue; }
    if (groups.number !== undefined) { tokens.push({ kind: 'number', text }); continue; }
    if (groups.hash !== undefined) {
      const hk = hashKind(lang);
      if (hk === 'plain') {
        // В этом языке `#` — обычный символ: отдаём первый знак, остальное
        // пусть разберётся как обычный код (например `this.#x` в JS).
        tokens.push({ kind: 'plain', text: '#' });
        const rest = groups.hash.slice(1);
        if (rest) tokens.push(...tokenizeLine(rest, lang));
        return tokens;
      }
      tokens.push({ kind: hk, text: groups.hash });
      continue;
    }
    if (groups.name !== undefined) {
      let kind: TokenKind = 'plain';
      if (KEYWORDS[text]) kind = 'keyword';
      else if (BUILTINS[text]) kind = 'builtin';
      else if (isMarkup(lang) && HTML_TAGS[text.toLowerCase()]) kind = 'tag';
      else if (text[0] === text[0]?.toUpperCase() && /[A-Z]/.test(text[0])) kind = 'type';
      else if (line[TOKEN_RE.lastIndex] === '(') kind = 'function';
      else if (looksLikeType(text, prevWord)) kind = 'type';
      if (kind === 'plain' && /^[A-Z]/.test(text) && lang === 'java') kind = 'type';
      tokens.push({ kind, text });
      prevWord = text;
      continue;
    }
    tokens.push({ kind: 'plain', text });
  }
  return tokens;
}
