import { invoke } from '@/lib/invoke-shim';
import { useOpenCoreStore } from '@/stores/opencoreStore';
import type {
  ChatMessage,
  ToolCall,
  PermissionRequest,
  PortalRoot,
  CmdResult,
  FetchResult,
  FsEntry,
} from '@/lib/opencore/types';

// ---------------------------------------------------------------------------
// Описания инструментов (единый реестр для всех форматов провайдеров)
// ---------------------------------------------------------------------------

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Рут, к которому привязан инструмент (для пермишн-ключа root: '*' = любой). */
  root?: PortalRoot | '*';
  requiresPermission: boolean;
}

export const TOOLS: ToolDef[] = [
  {
    name: 'web_search',
    description:
      'Поиск в интернете по текстовому запросу (DuckDuckGo): вернёт до 8 результатов — заголовок, URL, сниппет. ' +
      'Используй для «найди/поищи/что там по теме», для ответов на актуальные вопросы, для поиска страниц перед чтением. ' +
      'Если передана ссылка (http) — просто прочитает страницу целиком.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Короткий поисковый запрос (2–6 слов)' },
        max_results: { type: 'number', description: 'Сколько результатов вернуть (1–8, по умолчанию 5)' },
      },
      required: ['query'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'fetch_page',
    description:
      'Читает конкретную веб-страницу по URL и возвращает её текст. Используй для документации, GitHub README/issues, ' +
      'страниц модов, release-нот — когда знаешь точный адрес или он получен из web_search.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Полный URL страницы' },
        max_chars: { type: 'number', description: 'Максимум символов текста (до 120000, по умолчанию 20000)' },
      },
      required: ['url'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'http_request',
    description:
      'Прямой HTTP-запрос к любому REST API (GitHub, GitLab, любой сервис). Обходит CORS, идёт через бэкенд. ' +
      'Если для хоста сохранён токен — заголовок Authorization: Bearer <токен> подставится автоматически. ' +
      'Используй для работы с API: репозитории, issues, releases, webhooks и т.п.',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], description: 'HTTP-метод (по умолчанию GET)' },
        url: { type: 'string', description: 'Полный адрес эндпоинта' },
        headers: { type: 'object', description: 'Необязательные заголовки (объект имя: значение)' },
        jsonBody: { type: 'object', description: 'JSON-тело запроса (для POST/PUT/PATCH), сериализуется автоматически' },
        body: { type: 'string', description: 'Сырое тело запроса (если не jsonBody)' },
        timeout_ms: { type: 'number', description: 'Таймаут в мс (до 600000)' },
      },
      required: ['url'],
    },
    root: '*',
    requiresPermission: true,
  },
  {
    name: 'set_service_token',
    description:
      'Сохраняет API-токен сервиса (например GitHub) локально в настройках портала. После этого http_request для этого хоста ' +
      'сам добавит Authorization: Bearer. Спросит подтверждение у пользователя. Никому не отправляется.',
    parameters: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Хост сервиса, например api.github.com или gitlab.com' },
        token: { type: 'string', description: 'Сам токен' },
      },
      required: ['host', 'token'],
    },
    root: '*',
    requiresPermission: true,
  },
  {
    name: 'spawn_agents',
    description:
      'Запускает параллельно несколько субагентов: каждый получает свою часть общей задачи и работает автономно ' +
      'инструментами (поиск, чтение страниц, файлы, команды, HTTP). В конце возвращает сводный отчёт всех субагентов. ' +
      'Используй для больших задач, где можно параллелить: исследование, сравнение, сбор информации по нескольким темам разом.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Общая задача, которую субагенты делят между собой' },
        agents: {
          type: 'array',
          description: 'Список субагентов (до 5)',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Короткое имя субагента' },
              instructions: { type: 'string', description: 'Точная инструкция: что именно найти/сделать и в каком виде вернуть' },
            },
            required: ['name', 'instructions'],
          },
        },
      },
      required: ['task', 'agents'],
    },
    root: '*',
    requiresPermission: true,
  },
  {
    name: 'list_dir',
    description: 'Список содержимого каталога в песочнице. Вернёт файлы и папки с размерами.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Зона: portal — папка OpenPortal, temp — системная Temp, launcher — каталог лаунчера' },
        path: { type: 'string', description: 'Абсолютный путь внутри зоны' },
      },
      required: ['root', 'path'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'read_text',
    description: 'Читает текстовый файл (до 512 КБ) из песочницы. Для, например, settings.json, README, TODO, логов.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Зона: portal | temp | launcher' },
        path: { type: 'string', description: 'Абсолютный путь к файлу' },
      },
      required: ['root', 'path'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'write_text',
    description:
      'Создаёт/перезаписывает текстовый файл в песочнице (выполнение запросит разрешение). ' +
      'Писать лаунчер можно только в settings.json. Никогда не переписывай исходники лаунчера.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Зона записи' },
        path: { type: 'string', description: 'Абсолютный путь к файлу' },
        content: { type: 'string', description: 'Новое содержимое' },
      },
      required: ['root', 'path', 'content'],
    },
    root: '*',
    requiresPermission: true,
  },
  {
    name: 'run_command',
    description:
      'Запускает команду в песочнице (выполнение запросит разрешение). ' +
      'Рабочая папка обязательно внутри зоны. Используй для git init/commit/pull, npm/pnpm, сборок, тестов.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Зона, в которой лежит cwd' },
        cwd: { type: 'string', description: 'Рабочая папка (абсолютный путь внутри зоны)' },
        command: { type: 'string', description: 'Команда для cmd/sh' },
        timeout_ms: { type: 'number', description: 'Таймаут, мс (по умолчанию 120000)' },
        shell: { type: 'string', enum: ['cmd', 'powershell'], description: 'Оболочка: cmd (по умолчанию) или powershell' },
      },
      required: ['root', 'cwd', 'command'],
    },
    root: '*',
    requiresPermission: true,
  },
  {
    name: 'terminal',
    description:
      'Запускает команду в PowerShell-терминале (выполнение запросит разрешение). ' +
      'Рабочая папка обязательно внутри зоны. `shell` по умолчанию powershell.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Зона, в которой лежит cwd' },
        cwd: { type: 'string', description: 'Рабочая папка (абсолютный путь внутри зоны)' },
        command: { type: 'string', description: 'Команда для PowerShell' },
        timeout_ms: { type: 'number', description: 'Таймаут, мс (по умолчанию 120000)' },
      },
      required: ['root', 'cwd', 'command'],
    },
    root: '*',
    requiresPermission: true,
  },
  {
    name: 'generate_image',
    description:
      'Генерирует изображение через активного провайдера (если он поддерживает images API). ' +
      'Результат — файл с изображением; вставь его в ответ как `![подпись](/op-image/<name>)`.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Описание того, что должно быть на картинке (по-русски или по-английски)' },
        size: { type: 'string', enum: ['512x512', '1024x1024', '2048x2048'], description: 'Размер изображения (по умолчанию 1024x1024)' },
      },
      required: ['prompt'],
    },
    root: 'portal',
    requiresPermission: true,
  },
];

// ---------------------------------------------------------------------------
// Выполнение инструментов
// ---------------------------------------------------------------------------

export interface ExecResult {
  ok: boolean;
  output: string;
}

/** HTTP-запрос через Rust (нет CORS, есть сеть бэкенда). Нужен инструментам и фолбэку провайдеров. */
async function httpViaRust(
  method: string,
  url: string,
  headers: Record<string, string> | undefined,
  body: string | null,
  timeout_ms?: number,
): Promise<FetchResult> {
  const pairs: [string, string][] = headers
    ? Object.entries(headers).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
    : [];
  return invoke<FetchResult>('op_http_request', {
    url,
    method,
    headers: pairs,
    body,
    timeout_ms: timeout_ms ?? 120000,
  });
}

/**
 * opencode.ai не отдаёт `Access-Control-Allow-Origin` для origin'а вебвью
 * (`tauri.localhost`) — `fetch()` из вебвью к нему всегда падает по CORS.
 * Для таких хостов сразу идём через бэкенд (`op_http_request`).
 */
function canFetchFromWebview(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !host.endsWith('opencode.ai');
  } catch {
    return false;
  }
}

// opencode.ai/zen отклоняет запросы «извне OpenCode» («OpenCode Free Tier can
// only be used from within OpenCode»). Проверку проходят только запросы с
// заголовками официального клиента: User-Agent "opencode", x-opencode-client,
// стабильный x-opencode-session, уникальный x-opencode-request и
// x-opencode-project.
let zenSessionId: string | null = null;

function zenClientHeaders(): Record<string, string> {
  if (!zenSessionId) zenSessionId = crypto.randomUUID();
  return {
    'User-Agent': 'opencode',
    'x-opencode-client': 'desktop',
    'x-opencode-session': zenSessionId,
    'x-opencode-request': crypto.randomUUID(),
    'x-opencode-project': 'portal-launcher',
  };
}

function isZenHost(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('opencode.ai');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Интернет: поиск (DuckDuckGo) и чтение страниц
// ---------------------------------------------------------------------------

function htmlDecode(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `//duckduckgo.com/l/?uddg=<url>` → реальный URL результата. */
function decodeDdgHref(href: string): string {
  let h = href.trim();
  if (h.startsWith('//')) h = 'https:' + h;
  const m = /[?&]uddg=([^&]+)/.exec(h);
  if (m) {
    try {
      const dec = decodeURIComponent(m[1]);
      if (/^https?:\/\//i.test(dec)) return dec;
    } catch { /* оставляем оригинал */ }
  }
  return h;
}

/** Парсер HTML-выдачи DuckDuckGo (html.duckduckgo.com) без внешних зависимостей. */
function parseDuckDuckGo(html: string, max: number): { title: string; url: string; snippet: string }[] {
  const out: { title: string; url: string; snippet: string }[] = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < max) {
    const url = decodeDdgHref(m[1]);
    const title = htmlDecode(m[2]);
    if (!title || !/^https?:\/\//i.test(url)) continue;
    const seg = html.slice(m.index + m[0].length, m.index + m[0].length + 900);
    const sm = /result__snippet[^>]*>([\s\S]*?)<\/a>/i.exec(seg);
    out.push({ title, url, snippet: sm ? htmlDecode(sm[1]) : '' });
  }
  return out;
}

/** Поиск по интернету через DuckDuckGo. Если user передал URL — просто прочитать страницу. */
async function execWebSearch(args: { query?: string; url?: string; max_results?: number }): Promise<ExecResult> {
  const rawQuery = String(args.query ?? args.url ?? '').trim();
  if (!rawQuery) return { ok: false, output: 'Нет поискового запроса (query).' };
  if (/^https?:\/\//i.test(rawQuery)) {
    return execFetchPage({ url: rawQuery, max_chars: args.max_results ? args.max_results * 2000 : undefined });
  }
  const max = Math.max(1, Math.min(8, Number(args.max_results) || 5));
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(rawQuery)}`;
  let res: FetchResult;
  try {
    res = await invoke<FetchResult>('op_web_fetch', { url });
  } catch (e) {
    return { ok: false, output: `Поиск не выполнился: ${String(e)}` };
  }
  if (!res.ok && res.status === 0) {
    return { ok: false, output: `Поиск не выполнился: ${res.error ?? 'нет сети'}` };
  }
  const results = parseDuckDuckGo(res.text, max);
  if (results.length === 0) {
    return {
      ok: false,
      output: `Поиск по «${rawQuery}» не дал результатов. Попробуй иначе сформулировать запрос или прочитай конкретную страницу через fetch_page(url).`,
    };
  }
  const body = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet || '(описание недоступно)'}`).join('\n');
  return { ok: true, output: `Результаты поиска по «${rawQuery}»:\n\n${body}` };
}

async function execFetchPage(args: { url?: string; max_chars?: number }): Promise<ExecResult> {
  const url = String(args.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, output: 'Нет корректного url — это должен быть полный http(s) адрес страницы.' };
  }
  const res = await invoke<FetchResult>('op_web_fetch', { url });
  if (!res.ok || (res.text.length === 0 && res.error)) {
    const hint = !res.status
      ? 'Не удалось загрузить страницу (нет сети или сайт недоступен).'
      : `Сайт вернул HTTP ${res.status}.`;
    return { ok: false, output: `${hint} ${res.error ?? ''}`.trim() };
  }
  const maxChars = Math.min(120_000, Number(args.max_chars) || 20_000);
  const text = res.text.length > maxChars ? res.text.slice(0, maxChars) + '\n… (обрезано)' : res.text;
  return { ok: true, output: `HTTP ${res.status}\n${text}` };
}

async function lookupRoot(root: PortalRoot): Promise<string> {
  const layout = await invoke<{ temp: string; launcher: string; base: string; projects: string }>('op_layout');
  switch (root) {
    case 'portal': return layout.base;
    case 'temp': return layout.temp;
    case 'launcher': return layout.launcher;
    default: return layout.base;
  }
}

async function execListDir(args: { root: PortalRoot; path: string }): Promise<ExecResult> {
  try {
    const entries = await invoke<FsEntry[]>('op_list_dir', { root: String(args.root), path: args.path });
    if (entries.length === 0) return { ok: true, output: '(каталог пуст)' };
    const lines = entries.map(e =>
      `${e.is_dir ? '[dir ]' : '[file]'} ${e.name}${e.is_dir ? '/' : ''}${e.is_dir ? '' : `  (${fmtSize(e.size)})`}`,
    );
    return { ok: true, output: lines.join('\n') };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Blob → base64-строка (для сохранения скачанного изображения). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).replace(/^data:[^,]+,/, ''));
    fr.onerror = () => reject(fr.error ?? new Error('FileReader error'));
    fr.readAsDataURL(blob);
  });
}

async function execReadText(args: { root: PortalRoot; path: string }): Promise<ExecResult> {
  try {
    const text = await invoke<string>('op_read_text', { root: String(args.root), path: args.path });
    return { ok: true, output: text || '(файл пуст)' };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execWriteText(args: { root: PortalRoot; path: string; content: string }): Promise<ExecResult> {
  try {
    await invoke('op_write_text', { root: String(args.root), path: args.path, content: args.content });
    return { ok: true, output: `Записано в ${args.path}` };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execRunCommand(args: { root: PortalRoot; cwd: string; command: string; timeout_ms?: number; shell?: string }): Promise<ExecResult> {
  try {
    const res = await invoke<CmdResult>('op_run_command', {
      root: String(args.root),
      cwd: args.cwd,
      command: args.command,
      timeout_ms: args.timeout_ms ?? 120000,
      shell: args.shell ?? null,
    });
    const parts: string[] = [`exit=${res.exit_code}`];
    if (res.timed_out) parts.push('[превышен таймаут]');
    if (res.stdout.trim()) parts.push('--- stdout ---\n' + res.stdout.slice(0, 12000));
    if (res.stderr.trim()) parts.push('--- stderr ---\n' + res.stderr.slice(0, 6000));
    return { ok: res.exit_code === 0, output: parts.join('\n') };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

/** Генерация изображения через images API активного провайдера (OpenAI-совместимо). */
async function execGenerateImage(ep: ResolvedEndpoint, args: { prompt: string; size?: string }): Promise<ExecResult> {
  if (!ep.baseUrl) return { ok: false, output: 'Не настроен baseUrl провайдера для генерации.' };
  if (!ep.apiKey) return { ok: false, output: `Нет API-ключа для ${ep.provider.name}. Добавь ключ в меню моделей.` };
  const url = `${ep.baseUrl.replace(/\/+$/, '')}/images/generations`;
  const body = {
    model: ep.model.id,
    prompt: args.prompt,
    n: 1,
    size: args.size ?? '1024x1024',
    response_format: 'b64_json',
  };
  let data: any;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ep.apiKey}`,
    ...(isZenHost(url) ? zenClientHeaders() : {}),
  };
  if (canFetchFromWebview(url)) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, output: `${ep.provider.name} вернул HTTP ${res.status}: ${text.slice(0, 400)}` };
      }
      data = await res.json().catch(() => null);
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') throw e;
    }
  }
  if (data === undefined) {
    const fr = await httpViaRust('POST', url, headers, JSON.stringify(body), 180000);
    if (!fr.ok) {
      const snippet = fr.text.trim().slice(0, 240);
      return { ok: false, output: `Генерация недоступна: нет сети через веб-вью и HTTP ${fr.status} через бэкенд. ${fr.error ?? ''}${snippet ? ` Ответ сервера: ${snippet}` : ''}`.trim() };
    }
    try {
      data = JSON.parse(fr.text);
    } catch {
      return { ok: false, output: `${ep.provider.name} прислал неожиданный ответ при фолбэке через бэкенд.` };
    }
  }

  const b64: string | undefined = data?.data?.[0]?.b64_json ?? data?.data?.[0]?.b64 ?? data?.b64_json;
  if (!b64) {
    const rev = data?.data?.[0]?.url;
    if (rev && /^https?:/i.test(rev)) {
      try {
        const blobRes = await fetch(rev);
        if (!blobRes.ok) return { ok: false, output: `Скачивание изображения: HTTP ${blobRes.status}` };
        const blob = await blobRes.blob();
        const b64 = await blobToBase64(blob);
        const name = await invoke<string>('op_save_image', { b64 });
        return { ok: true, output: `Изображение: /op-image/${name}` };
      } catch (e) {
        return { ok: false, output: `Не удалось скачать изображение: ${String(e)}` };
      }
    }
    return { ok: false, output: 'Провайдер не вернул изображение (ожидали b64_json).' };
  }
  try {
    const name = await invoke<string>('op_save_image', { b64 });
    return { ok: true, output: `Изображение: /op-image/${name}` };
  } catch (e) {
    return { ok: false, output: `Не удалось сохранить картинку: ${String(e)}` };
  }
}

// ---------------------------------------------------------------------------
// Новые инструменты: http_request, set_service_token, spawn_agents (субагенты)
// ---------------------------------------------------------------------------

function maskToken(t: string): string {
  if (t.length <= 8) return '••••';
  return `${t.slice(0, 4)}••••${t.slice(-4)}`;
}

function truncateText(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\n… (обрезано)' : s;
}

/** Находит сохранённый токен для хоста url (точное совпадение или поддомен). */
function bearerForUrl(url: string, tokens: Record<string, string> | undefined): string | undefined {
  if (!tokens) return undefined;
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (tokens[host]) return tokens[host];
  for (const [k, v] of Object.entries(tokens)) {
    const key = k.toLowerCase();
    if (host === key || host.endsWith(`.${key}`)) return v;
  }
  return undefined;
}

async function execHttpRequest(
  ep: ResolvedEndpoint,
  args: any,
  requestPermission: (req: PermissionRequest) => Promise<'allow' | 'deny' | 'always' | 'never'>,
): Promise<ExecResult> {
  const method = String(args.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
    return { ok: false, output: `Метод ${method} не поддерживается (GET/POST/PUT/PATCH/DELETE/HEAD).` };
  }
  const url = String(args.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, output: 'Некорректный url — только http/https.' };
  }
  const decision = await requestPermission({
    tool: 'http_request',
    root: 'portal',
    label: 'HTTP-запрос к API',
    detail: `${method} ${url}`,
    cwdLabel: `HTTP → ${url.slice(0, 70)}`,
    resolve: () => {},
  });
  if (decision === 'deny' || decision === 'never') return { ok: false, output: 'Пользователь не разрешил HTTP-запрос.' };
  if (decision !== 'allow' && decision !== 'always') return { ok: false, output: 'Разрешение не получено.' };

  const headers: Record<string, string> = {};
  if (args.headers && typeof args.headers === 'object') {
    for (const [k, v] of Object.entries(args.headers)) {
      if (typeof v === 'string' || typeof v === 'number') headers[k] = String(v);
    }
  }
  const bearer = bearerForUrl(url, ep.serviceTokens);
  if (bearer && !Object.keys(headers).some(k => k.toLowerCase() === 'authorization')) {
    headers['Authorization'] = `Bearer ${bearer}`;
  }
  let body: string | null = null;
  if (method !== 'GET' && args.jsonBody && typeof args.jsonBody === 'object') {
    body = JSON.stringify(args.jsonBody);
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
  } else if (typeof args.body === 'string') {
    body = args.body;
  }

  let res: FetchResult;
  try {
    res = await httpViaRust(method, url, headers, body, args.timeout_ms);
  } catch (e) {
    return { ok: false, output: `HTTP-запрос не выполнился: ${String(e)}` };
  }
  if (!res.ok && res.status === 0) {
    return { ok: false, output: `HTTP-запрос не выполнился: ${res.error ?? 'нет сети'}` };
  }
  if (!res.ok) {
    return { ok: false, output: `${method} ${url} → HTTP ${res.status}: ${(res.error ?? res.text).slice(0, 400)}` };
  }
  if (res.content_type.includes('json') && res.text.trim()) {
    try {
      const parsed = JSON.parse(res.text);
      return { ok: true, output: truncateText(JSON.stringify(parsed, null, 2), 60000) };
    } catch { /* не JSON — отдаём текст */ }
  }
  return { ok: true, output: `${method} ${url} → HTTP ${res.status}\n${truncateText(res.text, 20000)}` };
}

async function execSetServiceToken(
  ep: ResolvedEndpoint,
  args: any,
  requestPermission: (req: PermissionRequest) => Promise<'allow' | 'deny' | 'always' | 'never'>,
): Promise<ExecResult> {
  const host = String(args.host || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const token = String(args.token || '').trim();
  if (!host) return { ok: false, output: 'Укажи host сервиса, например api.github.com.' };
  if (!token) return { ok: false, output: 'Укажи token.' };
  if (!ep.onSetToken) return { ok: false, output: 'Сохранение токенов сервисов недоступно.' };
  const decision = await requestPermission({
    tool: 'set_service_token',
    root: 'portal',
    label: 'Сохранение токена сервиса',
    detail: `Хост: ${host}\nТокен: ${maskToken(token)}`,
    cwdLabel: `Сервис → ${host}`,
    resolve: () => {},
  });
  if (decision === 'deny' || decision === 'never') return { ok: false, output: 'Пользователь не разрешил сохранение токена.' };
  if (decision !== 'allow' && decision !== 'always') return { ok: false, output: 'Разрешение не получено.' };
  ep.onSetToken(host, token);
  return {
    ok: true,
    output: `Токен сохранён локально для ${host}. Инструмент http_request теперь подставляет его в Authorization автоматически.`,
  };
}

// ---------------------------------------------------------------------------
// Субагенты: параллельный запуск отдельных агентов (как Task-инструмент)
// ---------------------------------------------------------------------------

let subAgentDepth = 0;

function subAgentSystemPrompt(name: string): string {
  const layout = useOpenCoreStore.getState().layout;
  const env = layout
    ? `Портал (OpenPortal): ${layout.base}\nProjects: ${layout.projects}\nTemp: ${layout.temp}\nЛаунчер: ${layout.launcher}`
    : `Зоны: portal (OpenPortal), temp (Temp), launcher (лаунчер). Пути уточни через list_dir.`;
  return [
    `Ты — субагент «${name}» внутри ИИ-агента OpenPortal (лаунчер Minecraft).`,
    ``,
    `Ты работаешь параллельно с другими субагентами над одной большой задачей. Твоя часть — только твоя ответственность, не дублируй работу других.`,
    ``,
    `Инструменты:`,
    `- web_search(query) — поиск в интернете.`,
    `- fetch_page(url) — прочитать страницу/документацию/GitHub-README.`,
    `- list_dir(root, path) / read_text / write_text — файлы в зонах portal | temp | launcher.`,
    `- run_command(root, cwd, command) / terminal — команды (git, curl, npm, python и т.п.); cwd обязательно внутри зоны.`,
    `- http_request — любой REST API (GitHub, GitLab и др.); сохранённый токен хоста подставляется автоматически.`,
    `- set_service_token — сохранить API-токен сервиса (спросит пользователя).`,
    `- spawn_agents — НЕ используй: субагентам запрещено запускать других субагентов.`,
    ``,
    `Окружение:\n${env}`,
    ``,
    `Правила:`,
    `- Действуй самостоятельно и до конца: ищи, читай, выполняй команды. Не задавай уточняющих вопросов пользователю.`,
    `- Если инструмент вернул ошибку — попробуй другой способ (другой URL, другой инструмент) и продолжай.`,
    `- В конце верни ТОЛЬКО итог по твоей части: факты, найденные данные, ответы, выводы, ссылки (до ~300 слов). Без приветствий и описания процесса.`,
  ].join('\n');
}

/** Отдельный агентный цикл субагента: свой контекст, свои инструменты, без GUI-стриминга. */
async function runSubAgentTurn(
  ep: ResolvedEndpoint,
  systemPrompt: string,
  userTaskText: string,
  requestPermission: (req: PermissionRequest) => Promise<'allow' | 'deny' | 'always' | 'never'>,
  signal?: AbortSignal,
  maxIterations = 6,
): Promise<string> {
  let msgs: ChatMessage[] = [
    { id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: 'user', content: userTaskText, timestamp: Date.now() },
  ];
  let lastText = '';
  for (let iter = 0; iter < maxIterations; iter++) {
    if (signal?.aborted) return '(остановлено пользователем)';
    let outcome: ApiOutcome;
    try {
      outcome = await callProvider(ep, systemPrompt, toTurns(msgs), signal);
    } catch (e: unknown) {
      return `Ошибка субагента: ${e instanceof Error ? e.message : String(e)}`;
    }
    lastText = outcome.text || lastText;
    if (!outcome.toolCalls?.length) {
      return outcome.text && outcome.text.trim() ? outcome.text : '(пустой ответ)';
    }
    msgs.push({ id: `sub-asst-${Date.now()}-${iter}`, role: 'assistant', content: outcome.text || '', toolCalls: outcome.toolCalls, timestamp: Date.now() });
    for (const tc of outcome.toolCalls) {
      if (signal?.aborted) return '(остановлено пользователем)';
      const tmId = `sub-tool-${Date.now()}-${iter}-${tc.id}`;
      msgs.push({ id: tmId, role: 'tool', content: '…', toolCallId: tc.id, toolName: tc.name, timestamp: Date.now() });
      const res = await executeTool(tc.name, tc.arguments, requestPermission, ep, signal);
      msgs = msgs.map(m => (m.id === tmId ? { ...m, content: res.output } : m));
    }
  }
  return (lastText || '(субагент не успел ответить)') + '\n\n(достигнут лимит итераций)';
}

async function execSpawnAgents(
  ep: ResolvedEndpoint,
  args: any,
  requestPermission: (req: PermissionRequest) => Promise<'allow' | 'deny' | 'always' | 'never'>,
  signal?: AbortSignal,
): Promise<ExecResult> {
  const agentsRaw: unknown[] = Array.isArray(args.agents) ? args.agents : [];
  const list: { name: string; instructions: string }[] = agentsRaw
    .map(item => {
      const a = item as { name?: unknown; instructions?: unknown };
      return {
        name: String(a?.name ?? 'Агент').slice(0, 60),
        instructions: String(a?.instructions ?? '').trim(),
      };
    })
    .filter(a => a.instructions.length > 0)
    .slice(0, 5);
  if (list.length === 0) {
    return { ok: false, output: 'Нужен список субагентов: agents: [{ name, instructions }, …] с непустыми instructions.' };
  }
  const task = String(args.task ?? '').trim();
  if (!task) return { ok: false, output: 'Укажи общую задачу (task).' };
  if (subAgentDepth > 0) return { ok: false, output: 'Субагентам запрещено запускать других субагентов.' };

  const decision = await requestPermission({
    tool: 'spawn_agents',
    root: 'portal',
    label: `Запуск ${list.length} субагентов`,
    detail: `Задача: ${task.slice(0, 160)}\nСубагенты: ${list.map(a => a.name).join(', ')}`,
    cwdLabel: `Субагенты × ${list.length}`,
    resolve: () => {},
  });
  if (decision === 'deny' || decision === 'never') return { ok: false, output: 'Пользователь не разрешил запуск субагентов.' };
  if (decision !== 'allow' && decision !== 'always') return { ok: false, output: 'Разрешение не получено.' };

  subAgentDepth++;
  try {
    const results = await Promise.all(
      list.map(async a => {
        const sys = subAgentSystemPrompt(a.name);
        const text = await runSubAgentTurn(
          ep,
          sys,
          `Общая задача:\n${task}\n\nТвоя часть:\n${a.instructions}`,
          requestPermission,
          signal,
          6,
        );
        return { name: a.name, text };
      }),
    );
    const sections = results.map(r => `### Субагент: ${r.name}\n\n${r.text.trim()}`).join('\n\n---\n\n');
    return {
      ok: true,
      output: `Отчёт ${results.length} субагентов (общая задача: ${task.slice(0, 120)}):\n\n${truncateText(sections, 60000)}`,
    };
  } finally {
    subAgentDepth--;
  }
}

export async function executeTool(
  tool: string,
  argsRaw: string,
  requestPermission: (req: PermissionRequest) => Promise<'allow' | 'deny' | 'always' | 'never'>,
  ep: ResolvedEndpoint,
  signal?: AbortSignal,
): Promise<ExecResult> {
  let args: any;
  try {
    args = JSON.parse(argsRaw || '{}');
  } catch {
    return { ok: false, output: 'Не удалось разобрать аргументы инструмента (JSON).' };
  }

  if (tool === 'web_search') return execWebSearch(args);
  if (tool === 'fetch_page') return execFetchPage(args);
  if (tool === 'http_request') return execHttpRequest(ep, args, requestPermission);
  if (tool === 'set_service_token') return execSetServiceToken(ep, args, requestPermission);
  if (tool === 'spawn_agents') return execSpawnAgents(ep, args, requestPermission, signal);

  if (tool === 'list_dir') return execListDir(args);
  if (tool === 'read_text') return execReadText(args);

  if (tool === 'generate_image') {
    if (!args.prompt || typeof args.prompt !== 'string') return { ok: false, output: 'Нет аргумента prompt.' };
    const root: PortalRoot = 'portal';
    const decision = await requestPermission({
      tool,
      root,
      label: 'Генерация изображения',
      detail: `Промпт: ${args.prompt}`,
      cwdLabel: `Генерация изображения → ${args.prompt.slice(0, 60)}`,
      resolve: () => {},
    });
    if (decision === 'deny' || decision === 'never') {
      return { ok: false, output: 'Пользователь не разрешил генерацию изображения.' };
    }
    if (decision === 'allow' || decision === 'always') {
      return execGenerateImage(ep, args);
    }
    return { ok: false, output: 'Разрешение не получено.' };
  }

  // Безопасные инструменты с запросом разрешения:
  if (tool === 'write_text' || tool === 'run_command' || tool === 'terminal') {
    const root: PortalRoot = String(args.root || 'portal') as PortalRoot;
    if (!['portal', 'temp', 'launcher'].includes(root)) {
      return { ok: false, output: `Неизвестная зона: ${root}` };
    }
    const rootBase = await lookupRoot(root);
    if (tool === 'terminal') {
      args = { ...args, shell: args.shell ?? 'powershell' };
    }
    const label = tool === 'write_text' ? 'Запись файла' : tool === 'terminal' ? 'Команда в PowerShell' : 'Выполнение команды';
    const detail = tool === 'write_text'
      ? `Путь: ${args.path}`
      : `Команда: ${args.command}\nПапка: ${args.cwd}`;
    const decision = await requestPermission({
      tool,
      root,
      label,
      detail,
      cwdLabel: `${label} → ${args.path ?? args.cwd ?? ''}`,
      resolve: () => {},
    });
    if (decision === 'deny' || decision === 'never') {
      return { ok: false, output: `Пользователь не разрешил: ${label}.` };
    }
    if (decision === 'allow' || decision === 'always') {
      if (tool === 'write_text') return execWriteText(args);
      return execRunCommand(args);
    }
    return { ok: false, output: 'Разрешение не получено.' };
  }

  return { ok: false, output: `Неизвестный инструмент: ${tool}` };
}

// ---------------------------------------------------------------------------
// Сборка тела запроса для разных форматов
// ---------------------------------------------------------------------------

import { OP_PROVIDERS, type ProviderDef, type ModelDef, type ProviderKind } from '@/lib/opencore/providers';

export interface ResolvedEndpoint {
  provider: ProviderDef;
  model: ModelDef;
  baseUrl: string;
  apiKey: string;
  format: 'openai' | 'anthropic';
  useZen: boolean;
  isCustom: boolean;
  /** Токены сервисов (host → token) для инструмента http_request. */
  serviceTokens?: Record<string, string>;
  /** Персист сохранённого токена сервиса. */
  onSetToken?: (host: string, token: string) => void;
}

export function resolveEndpoint(
  providerId: string,
  modelId: string,
  providersState: Record<string, { apiKey?: string; baseUrl?: string; remoteModels?: ModelDef[] }>,
): ResolvedEndpoint {
  const preset = OP_PROVIDERS.find(p => p.id === providerId);
  const st = providersState?.[providerId] ?? {};
  const isCustom = providerId.startsWith('custom:');

  let baseUrl: string;
  let kind: ProviderKind = preset?.kind ?? 'openai';
  let model: ModelDef;

  if (preset) {
    baseUrl = st.baseUrl || preset.baseUrl || '';
    // Модель может быть из API-списка (remoteModels), а не из реестра — ищем в обоих.
    model = preset.models.find(m => m.id === modelId)
      ?? (st.remoteModels ?? []).find(m => m.id === modelId)
      ?? { id: modelId };
  } else {
    // кастомный провайдер
    baseUrl = st.baseUrl || '';
    kind = baseUrl.includes('anthropic') ? 'anthropic' : 'openai';
    model = { id: modelId };
  }

  const useZen = kind === 'zen';
  const format: 'openai' | 'anthropic' =
    kind === 'anthropic' || (useZen && model.family === 'anthropic') ? 'anthropic' : 'openai';

  return {
    provider: preset ?? ({ id: providerId, name: 'Custom', kind: 'openai', baseUrl, models: [model] } as ProviderDef),
    model,
    baseUrl,
    apiKey: st.apiKey || '',
    format,
    useZen,
    isCustom,
    serviceTokens: {},
  };
}

export interface ChatTurn {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: ToolCall[];
  attachments?: { dataUrl?: string; base64?: string; type?: string }[];
}

// ---------------------------------------------------------------------------
// Нормализация ответов провайдеров в единый вид
// ---------------------------------------------------------------------------

export interface ApiOutcome {
  text: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  raw: unknown;
  model?: string;
}

export interface StreamDelta {
  /** Полный текущий текст ответа (для live-обновления одного сообщения). */
  content?: string;
  /** Полный текущий текст «рассуждений» модели. */
  thinking?: string;
}

export async function callProvider(
  ep: ResolvedEndpoint,
  systemPrompt: string,
  turns: ChatTurn[],
  signal?: AbortSignal,
  onDelta?: (d: StreamDelta) => void,
): Promise<ApiOutcome> {
  if (!ep.baseUrl) throw new Error('Не настроен baseUrl провайдера.');
  if (!ep.apiKey && ep.provider.kind !== 'zen' && !ep.provider.id.includes('custom:')) {
    // Локальные провайдеры (ollama/lmstudio) ключа не требуют
    if (!['ollama', 'lmstudio'].includes(ep.provider.id)) {
      throw new Error(`Нет API-ключа для ${ep.provider.name}. Добавь ключ в меню моделей.`);
    }
  }

  if (ep.format === 'anthropic') return callAnthropic(ep, systemPrompt, turns, signal);
  return callOpenAI(ep, systemPrompt, turns, signal, onDelta);
}

async function callOpenAI(
  ep: ResolvedEndpoint,
  systemPrompt: string,
  turns: ChatTurn[],
  signal?: AbortSignal,
  onDelta?: (d: StreamDelta) => void,
): Promise<ApiOutcome> {
  const url = ep.useZen
    ? `${ep.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`
    : `${ep.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const messages: any[] = [{ role: 'system', content: systemPrompt }];
  for (const t of turns) {
    if (t.role === 'user') {
      if (t.attachments && t.attachments.length > 0) {
        const images = t.attachments.filter(a => a.dataUrl || a.base64);
        if (images.length > 0) {
          messages.push({
            role: 'user',
            content: [
              { type: 'text', text: t.content },
              ...images.map(a => ({
                type: 'image_url',
                image_url: { url: a.dataUrl || `data:${a.type ?? 'image/png'};base64,${a.base64}` },
              })),
            ],
          });
          continue;
        }
      }
      messages.push({ role: 'user', content: t.content });
    } else if (t.role === 'assistant') {
      const msg: any = { role: 'assistant', content: t.content || null };
      if (t.toolCalls && t.toolCalls.length > 0) {
        msg.tool_calls = t.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      messages.push(msg);
    } else if (t.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: t.toolCallId,
        content: t.content,
      });
    }
  }

  const tools = TOOLS.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const body: Record<string, unknown> = {
    model: ep.model.id,
    messages,
    tools,
    temperature: 0.4,
    max_tokens: 8192,
  };
  if (onDelta) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {}),
    ...(ep.provider.id === 'openrouter' ? { 'HTTP-Referer': 'https://portal-launcher.app', 'X-Title': 'OpenPortal' } : {}),
    ...(isZenHost(url) ? zenClientHeaders() : {}),
  };

  let res: Response | null = null;
  if (canFetchFromWebview(url)) {
    try {
      res = await fetch(url, { method: 'POST', signal, headers, body: JSON.stringify(body) });
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') throw e;
    }
  }
  if (res === null) {
    // Фолбэк: веб-вью не может дотянуться (CORS/сеть) — идём через бэкенд.
    // Через бэкенд шлём не-стриминговый запрос: SSE-ответ без потоковой обработки
    // не разобрать, а часть шлюзов отклоняет стриминг от не-браузерных клиентов.
    const fbBody: Record<string, unknown> = {
      model: body.model,
      messages: body.messages,
      tools: body.tools,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
    };
    const fr = await httpViaRust('POST', url, { ...headers, Accept: 'application/json' }, JSON.stringify(fbBody), 180000);
    if (!fr.ok) {
      const snippet = fr.text.trim().slice(0, 240);
      throw new Error(`${ep.provider.name} недоступен: нет сети через веб-вью и HTTP ${fr.status} через бэкенд. ${fr.error ?? ''}${snippet ? ` Ответ сервера: ${snippet}` : ''}`.trim());
    }
    try {
      return parseOpenAIJson(JSON.parse(fr.text));
    } catch {
      throw new Error(`${ep.provider.name} прислал неожиданный ответ при фолбэке через бэкенд.`);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${ep.provider.name} вернул HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const ct = res.headers.get('content-type') || '';
  if (onDelta && res.body && ct.includes('text/event-stream')) {
    return parseSSE(res.body, signal, onDelta);
  }
  const data = await res.json();
  return parseOpenAIJson(data);
}

function parseOpenAIJson(data: any): ApiOutcome {
  const choice = data?.choices?.[0];
  const msg = choice?.message;
  const text = msg?.content || '';
  // Reasoning: DeepSeek/xAI/Grok и совместимые отдают as reasoning_content
  const thinking = trimThinking(msg?.reasoning_content ?? msg?.reasoning ?? '');
  const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc: any) => ({
    id: String(tc.id ?? ''),
    name: String(tc.function?.name ?? ''),
    arguments: String(tc.function?.arguments ?? '{}'),
  }));
  return {
    text: text ?? '',
    thinking: thinking || undefined,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    raw: data,
    model: data?.model,
  };
}

/** Разбор SSE-потока OpenAI-совместимого chat/completions. */
async function parseSSE(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  onDelta: (d: StreamDelta) => void,
): Promise<ApiOutcome> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let thinking = '';
  let model: string | undefined;
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

  const finish = (): ApiOutcome => {
    const calls: ToolCall[] = [...toolCalls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => ({ id: v.id, name: v.name, arguments: v.arguments || '{}' }));
    return {
      text,
      thinking: thinking ? trimThinking(thinking) : undefined,
      toolCalls: calls.length ? calls : undefined,
      raw: { stream: true },
      model,
    };
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return finish();
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      model = json.model ?? model;
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        text += delta.content;
        onDelta({ content: text });
      }
      if (delta.reasoning_content) {
        thinking += delta.reasoning_content;
        onDelta({ thinking });
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const cur = toolCalls.get(idx) ?? { id: '', name: '', arguments: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.arguments += tc.function.arguments;
          toolCalls.set(idx, cur);
        }
      }
    }
  }
  return finish();
}

async function callAnthropic(
  ep: ResolvedEndpoint,
  systemPrompt: string,
  turns: ChatTurn[],
  signal?: AbortSignal,
): Promise<ApiOutcome> {
  const base = `${ep.baseUrl.replace(/\/+$/, '')}`;
  const url = `${base}/v1/messages`;

  const messages: any[] = turns.map(t => {
    if (t.role === 'user') {
      if (t.attachments && t.attachments.length > 0) {
        const images = t.attachments.filter(a => a.dataUrl || a.base64);
        if (images.length > 0) {
          return {
            role: 'user',
            content: [
              { type: 'text', text: t.content },
              ...images.map(a => ({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: (a.type ?? 'image/png').replace('image/', 'image/'),
                  data: (a.base64 ?? a.dataUrl?.split(',')[1] ?? '') as string,
                },
              })),
            ],
          };
        }
      }
      return { role: 'user', content: t.content };
    }
    if (t.role === 'assistant') {
      const blocks: any[] = [];
      if (t.content) blocks.push({ type: 'text', text: t.content });
      if (t.toolCalls && t.toolCalls.length > 0) {
        for (const tc of t.toolCalls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: JSON.parse(tc.arguments || '{}') });
        }
      }
      return { role: 'assistant', content: blocks };
    }
    // tool
    return {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: t.toolCallId, content: t.content },
      ],
    };
  });

  const tools = TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  const body: Record<string, unknown> = {
    model: ep.model.id,
    max_tokens: 8192,
    system: systemPrompt,
    messages,
    tools,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    ...(isZenHost(url) ? zenClientHeaders() : {}),
  };
  if (ep.apiKey) headers['x-api-key'] = ep.apiKey;

  let res: Response | null = null;
  if (canFetchFromWebview(url)) {
    try {
      res = await fetch(url, { method: 'POST', signal, headers, body: JSON.stringify(body) });
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') throw e;
    }
  }
  if (res === null) {
    const fr = await httpViaRust('POST', url, headers, JSON.stringify(body), 180000);
    if (!fr.ok) {
      const snippet = fr.text.trim().slice(0, 240);
      throw new Error(`${ep.provider.name} недоступен: нет сети через веб-вью и HTTP ${fr.status} через бэкенд. ${fr.error ?? ''}${snippet ? ` Ответ сервера: ${snippet}` : ''}`.trim());
    }
    try {
      return parseAnthropicJson(JSON.parse(fr.text));
    } catch {
      throw new Error(`${ep.provider.name} прислал неожиданный ответ при фолбэке через бэкенд.`);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${ep.provider.name} вернул HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();

  return parseAnthropicJson(data);
}

function parseAnthropicJson(data: any): ApiOutcome {
  let text = '';
  let thinking: string | undefined;
  const toolCalls: ToolCall[] = [];
  for (const block of data?.content ?? []) {
    if (block.type === 'thinking') thinking = (thinking ? thinking + '\n' : '') + block.thinking;
    if (block.type === 'text') text += block.text;
    if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) });
  }
  return {
    text,
    thinking: thinking ? trimThinking(thinking) : undefined,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    raw: data,
    model: data?.model,
  };
}

function trimThinking(s: string): string {
  if (!s) return '';
  return s.length > 4000 ? s.slice(0, 4000) + '…' : s;
}

// ---------------------------------------------------------------------------
// Сжатие истории/контекста
// ---------------------------------------------------------------------------

export function compressHistory(messages: ChatMessage[], max = 48): ChatMessage[] {
  if (messages.length <= max) return messages;
  const head = messages.slice(0, 6);
  const tail = messages.slice(-Math.max(max - 8, 20));
  const summary: ChatMessage = {
    id: `__contraction-${Date.now()}`,
    role: 'assistant',
    content: `… [${messages.length - head.length - tail.length} сообщений сжато — история сокращена OpenPortal для экономии контекста] …`,
    timestamp: Date.now(),
  };
  return [...head, summary, ...tail];
}

// ---------------------------------------------------------------------------
// Системный промпт
// ---------------------------------------------------------------------------

export function buildSystemPrompt(opts: {
  mode: 'build' | 'plan';
  /** Доп. сведения об окружении (сборка, пути). */
  extra?: string;
  /** Установленные навыки (описание) — агент их знает. */
  skills?: string;
}): string {
  const rules = opts.mode === 'build'
    ? `Режим BUILD: ты полноценный агент-исполнитель. Ты достигаешь цели пользователя через инструменты: изучаешь файлы, правишь их, запускаешь команды, шаг за шагом добиваясь результата.`
    : `Режим PLAN: ты архитектор-аналитик. Ты НЕ изменяешь файлы и НЕ запускаешь команды. Отвечаешь детальным пошаговым планом: что сделать, какими файлами заняться, какие риски, как проверить результат.`;
  const skills = opts.skills?.trim()
    ? `\nУстановленные навыки (в папке OpenPortal/Skills/<slug>/SKILL.md — прочитай нужный, если задача соответствует):\n${opts.skills}`
    : '';
  return [
    `Ты — OpenPortal, встроенный агент посртал-лаунчера (Minecraft). Имя пользователя — хозяин лаунчера.`,
    `Режим: ${opts.mode === 'build' ? 'BUILD — выполнять' : 'PLAN — только план'}.`,
    rules,
    '',
    `Отвечай на русском, если пользователь не просил иначе. Пиши по делу: короткие абзацы, markdown (заголовки ## / ###, списки, \`\`\` код \`\`\`). Не приукрашивай, без эмодзи, без «вау», без лишних заверений.`,
    '',
    `ВАЖНО: обычные вопросы и задания — просто выполнить напрямую. Инструменты (включая web_search) используй ТОЛЬКО когда реально нужно: свежие данные из интернета, работа с файлами/системой/API. Для «hello», вопросов по общим знаниям, пересказов и рефакторинга кода в чате — отвечай сам, без инструментов.`,
    '',
    `Доступные инструменты (когда они нужны — обязательно используй, не описывай «я бы сделал»):`,
    `- web_search(query, max_results?) — поисковый запрос в интернете (актуальные данные, новости, гайды).`,
    `- fetch_page(url, max_chars?) — прочитать конкретную страницу/документацию/GitHub по URL.`,
    `- http_request(method, url, headers?, jsonBody?, body?) — прямой REST-запрос к любому API (GitHub, GitLab и др.); сохранённый токен хоста подставится сам.`,
    `- set_service_token(host, token) — сохранить API-токен сервиса локально (спросит пользователя).`,
    `- spawn_agents(task, agents[]) — параллельные субагенты для больших задач: исследование, сравнение, сбор информации по нескольким темам разом.`,
    `- list_dir(root, path) — список каталога. root: portal | temp | launcher.`,
    `- read_text(root, path) — прочесть текстовый файл (до 512 КБ).`,
    `- write_text(root, path, content) — создать/перезаписать файл (спросит разрешение у пользователя).`,
    `- run_command(root, cwd, command, timeout_ms) — команда (спросит разрешение). Оболочка по умолчанию cmd, можно передать shell: 'powershell'.`,
    `- terminal(root, cwd, command) — команда в PowerShell-терминале (спросит разрешение).`,
    `- generate_image(prompt, size?) — сгенерировать изображение (спросит разрешение).`,
    '',
    `Работа с сервисами (GitHub, git и др.):`,
    `- GitHub/git: используй http_request к api.github.com или локальные git-команды через run_command/terminal.`,
    `- Если API требует токен и его ещё нет — предложи пользователю, что ты сохранишь токен через set_service_token.`,
    `- Для приватных репозиториев и ускорения лимитов токен обязателен; хранится только локально в настройках портала.`,
    `- Структура данных из API приходит как JSON — сведи её к сути в ответе.`,
    '',
    `Как показывать изображения в чате: после generate_image ты получаешь ` + '`/op-image/<name>`' +
      ` — вставь его в ответ как markdown-картинку: ` + '`![описание](/op-image/<name>)`' +
      ` (пользователь может её скопировать или скачать).`,
    '',
    `Правила работы с файлами:`,
    `- Зона portal — папка OpenPortal (проекты, настройки агента); temp — системная Temp; launcher — каталог лаунчера.`,
    `- В launcher всегда можно читать. Писать можно только settings.json или внутри папки выбранной сборки.`,
    `- Перед изменениями проведи разведку: list_dir / read_text. Не гадай о содержимом — прочти.`,
    `- Не удаляй то, что не создавал, и не трогай чужие папки без явной просьбы.`,
    `- Команды запускай с осторожностью; для git/npm/pnpm работай в каталоге проекта.`,
    `- Опасные команды (форматирование, удаление системных файлов, изменение реестра, выключение ПК) запрещены и будут отклонены защитой.`,
    `- Если пользователь просит что-то, что выглядит как команда из списка (например /fetch <url>), выполни её через инструменты (web_search).`,
    '',
    `Каждое write_text / run_command / generate_image показывает пользователю модалку разрешения — дождись результата инструмента, его не будет, если пользователь отказал.`,
    `Создание навыков: если пользователь просит создать/установить навык — создай папку ` + '`<portal base>/Skills/<slug>/`' +
      ` и файл SKILL.md с frontmatter (name, description) и инструкциями.`,
    skills,
    ``,
    opts.extra ? `Окружение:\n${opts.extra}` : '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Оркестратор: цикл «запрос → инструменты → ещё запрос»
// ---------------------------------------------------------------------------

export interface RunTurnOptions {
  ep: ResolvedEndpoint;
  systemPrompt: string;
  /** Входные сообщения (уже включая новый user-turn). Возвращаются обновлённые. */
  input: ChatMessage[];
  mode: 'build' | 'plan';
  requestPermission: (req: PermissionRequest) => Promise<'allow' | 'deny' | 'always' | 'never'>;
  signal?: AbortSignal;
  onAppend?: (msgs: ChatMessage[]) => void;
  onUpdate?: (id: string, patch: Partial<ChatMessage>) => void;
  maxIterations?: number;
}

export async function runAgentTurn(opts: RunTurnOptions): Promise<ChatMessage[]> {
  const { ep, systemPrompt, requestPermission, signal, maxIterations = 12 } = opts;
  let messages: ChatMessage[] = opts.input;

  const push = (m: ChatMessage) => {
    messages = [...messages, m];
    opts.onAppend?.([m]);
  };
  const patch = (id: string, p: Partial<ChatMessage>) => {
    messages = messages.map(m => (m.id === id ? { ...m, ...p } : m));
    opts.onUpdate?.(id, p);
  };

  for (let iter = 0; iter < maxIterations; iter++) {
    if (signal?.aborted) throw new Error('Отменено пользователем.');

    const assistantId = `asst-${Date.now()}-${iter}`;
    // Заглушка — при стриминге тело заполняется по мере получения данных.
    push({
      id: assistantId,
      role: 'assistant',
      content: '',
      model: ep.model.id,
      timestamp: Date.now(),
    });

    const turns: ChatTurn[] = toTurns(messages);
    let outcome: ApiOutcome;
    try {
      outcome = await callProvider(ep, systemPrompt, turns, signal, d => {
        const patchData: Partial<ChatMessage> = {};
        if (d.content !== undefined) patchData.content = d.content;
        if (d.thinking !== undefined) patchData.thinking = d.thinking;
        if (Object.keys(patchData).length) patch(assistantId, patchData);
      });
    } catch (e: unknown) {
      if (signal?.aborted) throw new Error('Отменено пользователем.');
      throw e;
    }

    patch(assistantId, {
      content: outcome.text || '',
      thinking: outcome.thinking || undefined,
    });

    if (outcome.toolCalls?.length) {
      patch(assistantId, { toolCalls: outcome.toolCalls });

      for (let i = 0; i < outcome.toolCalls.length; i++) {
        if (signal?.aborted) throw new Error('Отменено пользователем.');
        const tc = outcome.toolCalls[i];
        const toolMsg: ChatMessage = {
          id: `tool-${tc.id}`, role: 'tool', content: '… выполняется …',
          toolCallId: tc.id, toolName: tc.name, timestamp: Date.now(),
        };
        push(toolMsg);
        const res = await executeTool(tc.name, tc.arguments, requestPermission, ep, signal);
        patch(toolMsg.id, { content: res.output, error: !res.ok });
        if (signal?.aborted) throw new Error('Отменено пользователем.');
      }

      if (iter === maxIterations - 1) {
        push({
          id: `final-${Date.now()}`,
          role: 'assistant',
          content: 'Достигнут лимит итераций. Опиши, что сделано, и предложи следующий шаг.',
          timestamp: Date.now(),
          model: ep.model.id,
        });
      }
      continue;
    }
    return messages;
  }
  return messages;
}

function toTurns(messages: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      turns.push({ role: 'user', content: m.content, attachments: m.attachments });
    } else if (m.role === 'assistant') {
      turns.push({
        role: 'assistant',
        content: m.content,
        toolCalls: m.toolCalls,
      });
    } else if (m.role === 'tool') {
      turns.push({
        role: 'tool',
        content: m.content,
        toolCallId: m.toolCallId,
        toolName: m.toolName,
      });
    }
  }
  return turns;
}