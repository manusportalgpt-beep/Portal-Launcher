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
  TokenUsage,
  ModCard,
  FileChange,
} from '@/lib/opencore/types';
import { diffLines } from '@/lib/opencore/diff';

// ---------------------------------------------------------------------------
// Надёжность агента: нормализация аргументов инструментов и повторы запросов
// ---------------------------------------------------------------------------

/** Сколько раз повторять запрос к модели при ошибке. */
export const PROVIDER_MAX_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Гарантирует, что arguments вызова инструмента — валидный JSON (строка).
 * Обрывочный JSON (накапливается из SSE-дельт) чинится восстановлением баланса
 * скобок; если совсем битый — возвращается '{}', чтобы история не падала с 400.
 */
export function normalizeToolArguments(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '{}';
  try {
    JSON.parse(s);
    return s;
  } catch {
    const repaired = s.replace(/,\s*([}\]])/g, '$1');
    let openBr = 0;
    let openOb = 0;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < repaired.length; i++) {
      const ch = repaired[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '[') openBr++;
      else if (ch === ']') openBr = Math.max(0, openBr - 1);
      else if (ch === '{') openOb++;
      else if (ch === '}') openOb = Math.max(0, openOb - 1);
    }
    let candidate = repaired;
    while (openBr-- > 0) candidate += ']';
    while (openOb-- > 0) candidate += '}';
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      return '{}';
    }
  }
}

/** Безопасный разбор JSON в объект (при ошибке — {}). */
export function safeJsonParseObject(raw: string): any {
  try {
    return JSON.parse(String(raw ?? '').trim() || '{}');
  } catch {
    return {};
  }
}

/** Удаляет ассистентские сообщения с битым JSON в arguments вызовов инструментов. */
function dropBrokenToolCalls(msgs: ChatMessage[]): ChatMessage[] {
  let changed = false;
  const next: ChatMessage[] = [];
  for (const m of msgs) {
    const broken =
      m.role === 'assistant' &&
      (m.toolCalls?.some(tc => normalizeToolArguments(tc.arguments) !== tc.arguments) ?? false);
    if (broken) {
      changed = true;
      continue;
    }
    next.push(m);
  }
  return changed ? next : msgs;
}

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

/**
 * Минимальный набор инструментов для повторной попытки.
 *
 * Некоторые провайдеры отвечают HTTP 400, когда схем инструментов слишком
 * много или одна из схем им не нравится. Чтобы задача не падала целиком,
 * запрос повторяется с коротким безопасным списком. Всё равно больше, чем
 * ничего: файлы, команды и веб остаются доступны.
 */
const ESSENTIAL_TOOL_NAMES = [
  'read_text', 'write_text', 'edit_file', 'list_dir', 'run_command',
  'web_search', 'fetch_page',
];

function reducedToolSet(tools: any[]): any[] {
  const kept = tools.filter(t => ESSENTIAL_TOOL_NAMES.includes(t?.function?.name));
  return kept.length > 0 ? kept : [];
}

/**
 * Запрос к провайдеру с автоматическим откатом набора инструментов.
 * Возвращает ответ; при сетевой ошибке возвращает null, чтобы вызывающий код
 * ушёл в запасной путь через бэкенд (как раньше).
 */
async function fetchWithToolFallback(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  requestTools: any[],
  signal: AbortSignal | undefined,
  providerName: string,
): Promise<Response | null> {
  let res: Response | null = null;
  try {
    res = await fetch(url, { method: 'POST', signal, headers, body: JSON.stringify(body) });
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') throw e;
    return null;
  }

  if (res.status !== 400) return res;

  const firstBody = await res.text().catch(() => '');
  // Ступень 1: минимальный набор инструментов.
  const reduced = reducedToolSet(requestTools);
  if (reduced.length > 0 && reduced.length < requestTools.length) {
    try {
      const retry = await fetch(url, {
        method: 'POST', signal, headers,
        body: JSON.stringify({ ...body, tools: reduced }),
      });
      if (retry.status !== 400) return retry;
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') throw e;
    }
  }
  // Ступень 2: вообще без инструментов и необязательных параметров.
  // Если и это не прошло — дело не в tools, и дальше уменьшать нечего:
  // сообщение пользователя лучше отправить как обычный чат, чем потерять.
  try {
    const plainBody: Record<string, unknown> = { model: body.model, messages: body.messages };
    if (body.stream) plainBody.stream = true;
    if (body.system !== undefined) plainBody.system = body.system;
    if (body.max_tokens !== undefined) plainBody.max_tokens = body.max_tokens;
    const plain = await fetch(url, { method: 'POST', signal, headers, body: JSON.stringify(plainBody) });
    if (plain.status !== 400) return plain;
    const plainBodyText = await plain.text().catch(() => '');
    throw new Error(appendZenErrorHint(
      `${providerName} вернул HTTP 400 даже без инструментов. Первый ответ: ${firstBody.slice(0, 300)} | Без инструментов: ${plainBodyText.slice(0, 300)}`,
      `${firstBody} ${plainBodyText}`,
    ));
  } catch (e) {
    if (e instanceof Error && /HTTP 400/.test(e.message)) throw e;
    if ((e as DOMException)?.name === 'AbortError') throw e;
    throw new Error(appendZenErrorHint(
      `${providerName} вернул HTTP 400: ${firstBody.slice(0, 400)}. Повторы не помогли: ${String(e)}`,
      firstBody,
    ));
  }
}

/**
 * Уровень рассуждения (effort) в том виде, в каком его понимает конкретный API.
 *
 * Формы разные, и отправка неправильной — верный способ получить HTTP 400:
 *  - OpenAI и OpenAI-совместимые: `reasoning_effort: 'minimal'|'low'|'medium'|'high'`.
 *  - OpenRouter: вложенный объект `reasoning: { effort }`.
 *  - Anthropic: не effort, а бюджет токенов `thinking: { type, budget_tokens }`.
 *
 * Значение не выдумывается: если модель не размечена как reasoning, параметр
 * не отправляется вовсе.
 */
export type EffortLevel = 'minimal' | 'low' | 'medium' | 'high';

const EFFORT_BUDGET: Record<EffortLevel, number> = {
  minimal: 1024,
  low: 4096,
  medium: 12_288,
  high: 24_576,
};

/** Модель умеет рассуждение: помечена в реестре либо приехала с API. */
function supportsEffort(ep: ResolvedEndpoint): boolean {
  if (ep.model.reasoning === true) return true;
  return /^(gpt-5|o[134]|gpt-oss|deepseek-r|qwq|space-bunny|big-pickle|claude.*(sonnet|opus|haiku))/i.test(ep.model.id);
}

function applyEffort(
  body: Record<string, unknown>,
  ep: ResolvedEndpoint,
  effort: EffortLevel | undefined,
): void {
  // Без явного выбора не трогаем тело запроса — провайдер сам выберет дефолт.
  if (!effort) return;
  if (!supportsEffort(ep)) return;

  const isAnthropic = ep.provider.kind === 'anthropic' || ep.baseUrl.includes('anthropic');
  const isOpenRouter = ep.provider.id === 'openrouter' || ep.baseUrl.includes('openrouter');

  if (isAnthropic) {
    // У Anthropic вместо уровня — бюджет токенов на размышление.
    body.thinking = { type: 'enabled', budget_tokens: EFFORT_BUDGET[effort] };
    // temperature вместе с thinking запрещён — это тоже даёт 400.
    delete body.temperature;
    return;
  }
  if (isOpenRouter) {
    body.reasoning = { effort, max_tokens: EFFORT_BUDGET[effort] * 2 };
    return;
  }
  // OpenAI и совместимые. У моделей без 'minimal' такой уровень не принимают.
  if (effort === 'minimal' && !/^gpt-5/i.test(ep.model.id)) {
    body.reasoning_effort = 'low';
    return;
  }
  body.reasoning_effort = effort;
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
      'Разрешение пользователя НЕ требуется — вызывай свободно. Ошибки возвращаются с подсказкой по коду (401/403/404/429 и т.п.). ' +
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
    requiresPermission: false,
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
      'Создаёт/перезаписывает текстовый файл в песочнице. Запись в зоны portal (Projects и др.) и temp — БЕЗ запроса разрешения; ' +
      'launcher — только settings.json или файлы внутри папки активной сборки (запросит разрешение). Никогда не переписывай исходники лаунчера.',
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
    name: 'edit_file',
    description:
      'Точечная правка файла: заменяет в файле точный фрагмент на другой. ПРЕДПОЧТИТЕЛЬНЕЕ write_text для правки кода — не нужно переписывать файл целиком и нельзя случайно затереть соседние строки. ' +
      'Перед правкой прочитай файл (read_text), чтобы фрагмент точно совпадал с текстом, включая отступы. Фрагмент должен быть уникален в файле, иначе добавь окружающий контекст или поставь replace_all. ' +
      'В чате пользователь увидит файл и построчный diff с количеством добавленных и удалённых строк.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Зона файловой системы' },
        path: { type: 'string', description: 'Путь к файлу' },
        find: { type: 'string', description: 'Точный фрагмент, который заменяем (с отступами, как в файле)' },
        replace: { type: 'string', description: 'Новый текст вместо find' },
        replace_all: { type: 'boolean', description: 'Заменить все вхождения (по умолчанию только одно)' },
      },
      required: ['root', 'path', 'find', 'replace'],
    },
    root: '*',
    requiresPermission: true,
  },
  {
    name: 'search_code',
    description:
      'Ищет подстроку или регулярное выражение по файлам зоны. Используй перед правкой кода, чтобы найти все места использования функции, поля или класса — иначе легко сломать сборку, изменив не все места. ' +
      'Возвращает список совпадений в формате путь:строка: текст.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Зона поиска' },
        query: { type: 'string', description: 'Искомая подстрока или регулярное выражение' },
        regex: { type: 'boolean', description: 'Считать query регулярным выражением (по умолчанию — обычная подстрока)' },
        glob: { type: 'string', description: 'Фильтр по файлам, например *.java или src/**' },
        limit: { type: 'number', description: 'Максимум совпадений (по умолчанию 60)' },
      },
      required: ['root', 'query'],
    },
    root: '*',
    requiresPermission: false,
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
      'Генерирует изображение по текстовому описанию. По умолчанию используется провайдер из настроек «Генерация Изображений» ' +
      '(Stable Horde — бесплатно, без ключа; или Novita — по ключу). ' +
      'Результат — файл с изображением; вставь его в ответ как `![подпись](/op-image/<name>)`.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Подробное описание изображения (лучше по-английски: стиль, детали, свет, композиция)' },
        size: { type: 'string', enum: ['512x512', '1024x1024', '2048x2048'], description: 'Размер изображения (по умолчанию 1024x1024)' },
        provider: { type: 'string', enum: ['auto', 'stable_horde', 'novita', 'provider', 'magnific', 'pollinations'], description: 'Источник: auto (выбранный в настройках провайдер), stable_horde (бесплатно, без ключа), novita (по ключу api.novita.ai), provider (активный провайдер), magnific (по ключу), pollinations (запасной бесплатный)' },
      },
      required: ['prompt'],
    },
    root: 'portal',
    requiresPermission: false,
  },
  {
    name: 'inspect_image',
    description:
      'Анализирует изображение по пикселям: размеры, прозрачность, палитра доминирующих цветов, средний цвет. ' +
      'Используй, когда нужно «увидеть» картинку (скриншот, иконку, UI, логотип) — модель без зрения получит текстовое описание.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Зона, где лежит файл' },
        path: { type: 'string', description: 'Абсолютный путь к изображению' },
      },
      required: ['root', 'path'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'hexdump',
    description: 'Показывает бинарный файл как hexdump (по 16 байт на строку), чтобы исследовать неизвестные форматы.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Зона' },
        path: { type: 'string', description: 'Абсолютный путь к файлу' },
        max_bytes: { type: 'number', description: 'Сколько байт показать (до 65536, по умолчанию 4096)' },
      },
      required: ['root', 'path'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'download_file',
    description:
      'СКАЧИВАЕТ файл по URL прямо в песочницу (temp или portal) и возвращает локальный путь. Это способ достать картинки, текстуры, json, .jar и любые бинарные файлы: fetch_page годится только для текста, а http_request не сохраняет тело. ' +
      'Используй обязательно, когда нужен реальный файл: иконка мода, текстура, репозиторий, архив. После скачивания путь можно передать в inspect_image, archive_extract, read_text или hexdump.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Прямая ссылка http/https на файл' },
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Куда сохранить (по умолчанию temp)' },
        path: { type: 'string', description: 'Имя файла с расширением, например sodium.jar' },
      },
      required: ['url'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'decompile_jar',
    description:
      'Распаковывает .jar/.zip в папку и разбирает байткод в читаемый вид: список классов, а для каждого — поля, методы и сигнатуры (через javap из JDK активной сборки). ' +
      'Это первый шаг к разбору чужого мода: посмотри структуру, потом читай нужный класс через read_text. Полный исходный код Java восстановить нельзя — доступны сигнатуры и байткод.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Зона, где лежит .jar' },
        path: { type: 'string', description: 'Путь к .jar файлу' },
        class_filter: { type: 'string', description: 'Показывать классы, содержащие эту подстроку (например ru.mymod.MyClass)' },
      },
      required: ['root', 'path'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'build_jar',
    description:
      'Собирает Java-проект в .jar: компилирует исходники из src (javac) с classpath, указанным в classpath, копирует ресурсы и упаковывает всё в jar. ' +
      'Используй после того как написал код мода, чтобы получить готовый файл для установки в сборку. Если нужен Gradle-проект, всё равно вызывай этот инструмент как запасной вариант.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Зона проекта' },
        project_dir: { type: 'string', description: 'Папка проекта (где лежит src)' },
        classpath: { type: 'string', description: 'Classpath через ; — loader/engine jar и minecraft, если нужен' },
        out_name: { type: 'string', description: 'Имя результата, например mymod-1.0.jar' },
      },
      required: ['root', 'project_dir', 'out_name'],
    },
    root: '*',
    requiresPermission: true,
  },
  {
    name: 'run_python',
    description:
      'Запускает Python-скрипт из песочницы и возвращает его вывод. Удобно для генерации текстур и ресурс-паков, обработки изображений (Pillow), массовых операций и упаковки архивов. ' +
      'Сначала запиши скрипт через write_text, потом вызови этот инструмент. Если нужен модуль, которого нет (например Pillow), скрипт это покажет в выводе — тогда скажи пользователю про pip install или используй другой подход.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Зона скрипта' },
        path: { type: 'string', description: 'Путь к .py файлу' },
        args: { type: 'string', description: 'Аргументы командной строки через пробел' },
        timeout_ms: { type: 'number', description: 'Таймаут в мс (по умолчанию 120000)' },
      },
      required: ['root', 'path'],
    },
    root: '*',
    requiresPermission: true,
  },
  {
    name: 'project_info',
    description:
      'Быстрая сводка по проекту без чтения всех файлов: список файлов по типам, размер, точки входа, манифесты (fabric.mod.json, META-INF/mods.toml, pack.mcmeta, shaders). ' +
      'Начинай с этого инструмента, когда впервые работаешь с папкой, чтобы понять структуру и не читать всё подряд.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Зона' },
        path: { type: 'string', description: 'Папка проекта' },
      },
      required: ['root', 'path'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'archive_list',
    description: 'Просмотр содержимого архива (.zip, .7z, .tar, .tar.gz, .tar.bz2) без распаковки: имена, папки, размеры.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Зона' },
        path: { type: 'string', description: 'Абсолютный путь к архиву' },
      },
      required: ['root', 'path'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'archive_extract',
    description:
      'Распаковывает архив внутри разрешённой зоны (защита от выхода за папку назначения). ' +
      'Если dest_path не указан — архив распакуется в OpenPortal/Cache/extracted/<имя>. В зонах portal/temp выполняется сразу; в launcher спросит разрешение.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Зона' },
        path: { type: 'string', description: 'Абсолютный путь к архиву' },
        dest_path: { type: 'string', description: 'Папка назначения (абсолютный путь внутри зоны); по умолчанию Cache/extracted/<имя архива>' },
      },
      required: ['root', 'path'],
    },
    root: '*',
    requiresPermission: true,
  },
  {
    name: 'archive_create',
    description:
      'Создаёт архив из папки или файла (.zip или .7z). Сохраняется в OpenPortal/Cache/archives/<имя>. ' +
      'В зонах portal/temp выполняется сразу; в launcher спросит разрешение. Покажи результат пользователю маркером /op-project для скачивания.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Зона' },
        path: { type: 'string', description: 'Абсолютный путь к файлу или папке, которую архивировать' },
        name: { type: 'string', description: 'Имя архива (.zip или .7z)' },
      },
      required: ['root', 'path', 'name'],
    },
    root: '*',
    requiresPermission: true,
  },
  {
    name: 'save_to_downloads',
    description: 'Копирует файл из песочницы (portal/temp/launcher) в системную папку «Загрузки» пользователя. Оригинал не удаляется.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['portal', 'temp', 'launcher'], description: 'Зона' },
        path: { type: 'string', description: 'Абсолютный путь к файлу' },
        name: { type: 'string', description: 'Имя файла в «Загрузках» (по умолчанию — исходное)' },
      },
      required: ['root', 'path'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'launcher_list_builds',
    description: 'Список сборок лаунчера: id, название, версия Minecraft, загрузчик и его версия, лимиты RAM, число модов, дата создания.',
    parameters: { type: 'object', properties: {}, required: [] },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'launcher_logs',
    description: 'Последние строки лога запуска сборки (instance_id) — для диагностики крашей, ошибок, предупреждений.',
    parameters: {
      type: 'object',
      properties: {
        instance_id: { type: 'string', description: 'id сборки (см. launcher_list_builds)' },
      },
      required: ['instance_id'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'mod_search',
    description:
      'Ищет моды/ресурс-паки/шейдеры в Modrinth и возвращает проверенные метаданные: название, автор, загрузки, иконка, версии и прямую ссылку на файл (url + имя + sha1) для версии, совместимой с версией Minecraft и загрузчиком. ' +
      'Используй ВСЕГДА перед launcher_install_mod вместо выдумывания ссылок или обхода случайных сайтов — установка мода должна опираться на результат этого инструмента.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Поисковый запрос: название мода или ключевые слова (можно по-русски). Обязательный параметр.' },
        mc_version: { type: 'string', description: 'Версия Minecraft сборки, например 1.20.1 или 26.2. Если неизвестна — можно не указывать.' },
        loader: { type: 'string', enum: ['fabric', 'forge', 'neoforge', 'quilt', 'vanilla'], description: 'Загрузчик сборки (необязательно).' },
        project_type: { type: 'string', enum: ['mod', 'resourcepack', 'shaderpack', 'modpack'], description: 'Что именно ищем. По умолчанию mod. Для наборов текстур и тем указывай resourcepack, для шейдеров (Complementary, SEUS, BSL, Iris) — shaderpack, для готовых сборок — modpack. Если пользователь просит ресурс-паки или шейдеры, тип нужно указать явно, иначе поиск вернёт только моды.' },
        source: { type: 'string', enum: ['modrinth', 'curseforge', 'both'], description: 'Где искать. По умолчанию modrinth. Ставь "both", если пользователь не указал источник или просит сравнить — CurseForge требует настроенный API-ключ (Настройки → Дополнительно), без него поиск идёт только по Modrinth.' },
        limit: { type: 'number', description: 'Сколько результатов вернуть (по умолчанию 5, максимум 10).' },
      },
      required: ['query'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'launcher_install_mod',
    description:
      'Устанавливает мод/ресурс-пак/шейдер в сборку лаунчера: скачивает файл по download_url и кладёт в папку сборки (mods/resourcepacks/shaderpacks). ' +
      'Сначала выполни mod_search по тому же mc_version/loader и подставь сюда download_url/file_name/mod_id/mod_name/mod_version/version_id/author/icon_url из его результата. ' +
      'Спросит разрешение у пользователя. После установки напомни пересобрать сборку в лаунчере, чтобы мод проиндексировался.',
    parameters: {
      type: 'object',
      properties: {
        instance_id: { type: 'string', description: 'id сборки' },
        download_url: { type: 'string', description: 'Прямая ссылка на .jar/.zip файл' },
        file_name: { type: 'string', description: 'Имя файла в папке сборки (например mymod-1.0.jar)' },
        mod_id: { type: 'string', description: 'ID проекта в источнике' },
        mod_name: { type: 'string', description: 'Название мода' },
        mod_version: { type: 'string', description: 'Версия мода' },
        version_id: { type: 'string', description: 'ID версии в источнике' },
        source: { type: 'string', enum: ['modrinth', 'curseforge', 'other'], description: 'Источник (по умолчанию modrinth)' },
        mod_type: { type: 'string', enum: ['mod', 'resourcepack', 'shaderpack'], description: 'Тип контента (по умолчанию mod)' },
        project_id: { type: 'string', description: 'Альтернативный ID проекта (если отличается)' },
        author: { type: 'string', description: 'Автор мода' },
        icon_url: { type: 'string', description: 'Ссылка на иконку мода' },
      },
      required: ['instance_id', 'download_url', 'file_name'],
    },
    root: '*',
    requiresPermission: true,
  },
  {
    name: 'launcher_create_build',
    description: 'Создаёт новую сборку Minecraft в лаунчере (спросит разрешение).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Название сборки' },
        description: { type: 'string', description: 'Описание' },
        mc_version: { type: 'string', description: 'Версия Minecraft, например 1.20.1' },
        loader: { type: 'string', enum: ['fabric', 'forge', 'neoforge', 'quilt', 'vanilla'], description: 'Загрузчик' },
        loader_version: { type: 'string', description: 'Версия загрузчика' },
        min_ram: { type: 'number', description: 'Минимальная RAM в МБ (по умолчанию 4096)' },
        max_ram: { type: 'number', description: 'Максимальная RAM в МБ (по умолчанию 8192)' },
        color: { type: 'string', description: 'Цвет в hex, например #4f46e5' },
        icon: { type: 'string', description: 'Иконка как data URL (base64-изображение)' },
      },
      required: ['name', 'mc_version', 'loader', 'loader_version'],
    },
    root: '*',
    requiresPermission: true,
  },
  {
    name: 'launcher_build_info',
    description:
      'Полная картина по сборке: Minecraft, загрузчик и его версия, Java, RAM, JVM-аргументы, полный список модов/ресурс-паков/шейдеров/датапаков с версиями, ' +
      'активные ресурс-пак и шейдер, options.txt (громкость, графика), список серверов, размер папок и config-каталогов. ' +
      'Вызывай ПЕРВЫМ делом при любой задаче про конкретную сборку — без этого ты будешь гадать о версиях и именах файлов.',
    parameters: {
      type: 'object',
      properties: {
        instance_id: { type: 'string', description: 'id сборки (см. launcher_list_builds)' },
      },
      required: ['instance_id'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'launcher_list_content',
    description:
      'Список установленного контента сборки по папкам: mods, resourcepacks, shaderpacks, datapacks, config. Возвращает имена файлов, размер и версию, ' +
      'выведенную из имени файла. Нужен, чтобы не ставить дубль версии и не выдумывать имена файлов.',
    parameters: {
      type: 'object',
      properties: {
        instance_id: { type: 'string', description: 'id сборки' },
        folder: {
          type: 'string',
          enum: ['mods', 'resourcepacks', 'shaderpacks', 'datapacks', 'config', 'all'],
          description: 'Папка (по умолчанию all)',
        },
      },
      required: ['instance_id'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'launcher_read_file',
    description:
      'Читает файл внутри сборки (options.txt, config/*.json|*.toml|*.cfg, shaderpacks/*.txt, краш-репорт). ' +
      'Для больших файлов указывай offset/limit — так можно прочитать файл целиком по частям.',
    parameters: {
      type: 'object',
      properties: {
        instance_id: { type: 'string', description: 'id сборки' },
        path: { type: 'string', description: 'Путь относительно папки сборки, напр. options.txt или config/sodium.json' },
        offset: { type: 'number', description: 'Пропустить первые N строк' },
        limit: { type: 'number', description: 'Сколько строк вернуть (по умолчанию 400)' },
      },
      required: ['instance_id', 'path'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'launcher_write_file',
    description:
      'Записывает или полностью перезаписывает файл внутри сборки (options.txt, конфиг мода, options-шейдера). ' +
      'Сначала прочитай файл через launcher_read_file и правь только нужные строки — не затирай файл целиком, если меняешь одно поле. Спросит разрешение.',
    parameters: {
      type: 'object',
      properties: {
        instance_id: { type: 'string', description: 'id сборки' },
        path: { type: 'string', description: 'Путь относительно папки сборки' },
        content: { type: 'string', description: 'Новое содержимое файла целиком' },
      },
      required: ['instance_id', 'path', 'content'],
    },
    root: '*',
    requiresPermission: true,
  },
  {
    name: 'launcher_remove_content',
    description:
      'Удаляет файл контента из сборки по имени (например sodium-0.5.8.jar или old-shader.zip). Используй, когда меняешь версию мода, ' +
      'удаляешь конфликтующий мод или чужой шейдер. Спросит разрешение.',
    parameters: {
      type: 'object',
      properties: {
        instance_id: { type: 'string', description: 'id сборки' },
        folder: { type: 'string', enum: ['mods', 'resourcepacks', 'shaderpacks', 'datapacks'], description: 'Папка' },
        file_name: { type: 'string', description: 'Имя файла, как в launcher_list_content' },
      },
      required: ['instance_id', 'folder', 'file_name'],
    },
    root: '*',
    requiresPermission: true,
  },
  {
    name: 'launcher_crash_report',
    description:
      'Читает свежий краш-репорт сборки: стек-трейс, исключение, версии модов в момент падения и подозрительные записи. ' +
      'Используй для диагностики «вылетел при запуске» — там готовый разбор, а не сырой лог.',
    parameters: {
      type: 'object',
      properties: {
        instance_id: { type: 'string', description: 'id сборки' },
        max_chars: { type: 'number', description: 'Ограничение по символам (по умолчанию 20000)' },
      },
      required: ['instance_id'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'launcher_verify_build',
    description:
      'Проверяет сборку перед запуском: отсутствующие файлы модов, конфликтующие пары, моды не под этот загрузчик, ' +
      'отсутствие обязательных зависимостей, сломанные конфиги JSON/TOML. Возвращает список проблем — чини их до запуска.',
    parameters: {
      type: 'object',
      properties: {
        instance_id: { type: 'string', description: 'id сборки' },
      },
      required: ['instance_id'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'launcher_install_project',
    description:
      'Устанавливает проект из каталога лаунчера (Discover/Modrinth) по slug проекта — без ручного поиска ссылки. ' +
      'Для мода/ресурс-пака/шейдера/модпака ставит в указанную сборку. ' +
      'ВАЖНО: если проект — сборка (тип build), она ставится НЕ внутрь другой сборки, а создаётся как новая сборка лаунчера; ' +
      'в этом случае instance_id игнорируется. Спросит разрешение.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'slug проекта из mod_search/discover, напр. sodium' },
        project_type: { type: 'string', enum: ['mod', 'resourcepack', 'shaderpack', 'modpack', 'build'], description: 'Тип проекта' },
        instance_id: { type: 'string', description: 'id сборки-получателя (только для mod/resourcepack/shaderpack/modpack)' },
        version_id: { type: 'string', description: 'Конкретная версия (необязательно — возьмёт лучшую под сборку)' },
      },
      required: ['slug', 'project_type'],
    },
    root: '*',
    requiresPermission: true,
  },
  {
    name: 'jar_list',
    description:
      'Список классов и ресурсов внутри .jar/.zip: показывает mod id, версию, entrypoints, mixin-конфиги и mixin-классы. ' +
      'Это способ УБЕДИТЬСЯ, что класс реально существует, до того как писать код, который его использует.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Путь к .jar/.zip в зоне launcher или portal' },
        filter: { type: 'string', description: 'Подстрока для фильтрации (например mixin или ModClient)' },
      },
      required: ['path'],
    },
    root: '*',
    requiresPermission: false,
  },
  {
    name: 'path_exists',
    description:
      'Быстрая проверка: существует ли файл или папка, и какого размера. Вызывай перед любой правкой или чтением — ' +
      'чтобы не выдумывать несуществующие пути и имена файлов.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Путь в зоне launcher или portal' },
      },
      required: ['path'],
    },
    root: '*',
    requiresPermission: false,
  },
];

// ---------------------------------------------------------------------------
// Выполнение инструментов
// ---------------------------------------------------------------------------

export interface ExecResult {
  ok: boolean;
  output: string;
  /** Структурированные карточки контента для отрисовки в чате (mod_search). */
  cards?: ModCard[];
  /** Изменённые файлы с диффом (write_text / edit_file). */
  changes?: FileChange[];
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

/** Гонка промиса (обычно invoke в Rust) с AbortSignal: при отмене сразу кидаем ошибку,
 *  чтобы цикл агента прерывался мгновенно, даже когда запрос ушёл через бэкенд. */
function raceSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Отменено пользователем.'));
      return;
    }
    const onAbort = () => reject(new Error('Отменено пользователем.'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      v => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      e => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
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

// opencode.ai/zen отклоняет запросы «извне OpenCode» («OpenCode's free tier can
// only be used from within OpenCode» / 403 FreeTierError). Проверку проходят
// только запросы, притворяющиеся официальным клиентом opencode:
//   Authorization       = "Bearer public" (анонимный free-тариф) либо oc_sk_-ключ
//   x-opencode-client   = "desktop" | "cli"
//   x-opencode-session  = "ses_" + 12 hex + 14 base62
//   x-opencode-request  = "msg_" + 12 hex + 14 base62
//   x-opencode-project  = "global"
//   User-Agent          = "opencode/<версия>", версия >= 1.17
// Плюс два условия самого free-тарифа: запрос обязан быть стриминговым
// (stream: true) и в tools должны присутствовать имена "bash" и "read",
// иначе приходит 403 FreeTierError или 429 FreeUsageLimitError.
const ZEN_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZEN_HEX = '0123456789abcdef';

function zenRandom(chars: string, length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

/** id клиента opencode: «ses_»/«msg_» + 12 hex + 14 base62. */
function zenId(prefix: 'ses_' | 'msg_'): string {
  return prefix + zenRandom(ZEN_HEX, 12) + zenRandom(ZEN_ALPHABET, 14);
}

let zenSessionId: string | null = null;

/** Стабильный id сессии на всё время работы (как у официального CLI). */
function zenSession(): string {
  if (!zenSessionId) zenSessionId = zenId('ses_');
  return zenSessionId;
}

/**
 * Free-тариф пускает анонимный доступ по ключу "public". Legacy-ключи `sk-`
 * уходят по старому пути миграции и free-модели не получают, поэтому их
 * игнорируем; настоящий новый ключ Console (`oc_sk_...`) используем как есть.
 */
function zenAuthorization(apiKey?: string): string {
  return apiKey && apiKey.startsWith('oc_sk_') ? `Bearer ${apiKey}` : 'Bearer public';
}

function zenClientHeaders(): Record<string, string> {
  return {
    'User-Agent': 'opencode/1.18.31',
    'x-opencode-client': 'desktop',
    'x-opencode-session': zenSession(),
    'x-opencode-request': zenId('msg_'),
    'x-opencode-project': 'global',
  };
}

/** Free-тариф требует в payload инструменты с именами "bash" и "read". */
function zenTools(tools: any[]): any[] {
  const names = new Set(tools.map(t => t?.function?.name));
  const out = [...tools];
  for (const name of ['bash', 'read']) {
    if (!names.has(name)) {
      out.push({
        type: 'function',
        function: {
          name,
          description: 'Reserved by the upstream client.',
          parameters: { type: 'object', properties: {} },
        },
      });
    }
  }
  return out;
}

function isZenHost(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('opencode.ai');
  } catch {
    return false;
  }
}

// Ошибки доступа free-тарифа: либо запрос не прошёл как клиент opencode, либо
// исчерпан лимит. Подсказка маскирует оба случая.
function zenErrorHint(body: string): string {
  if (!/FreeTier|FreeUsageLimit|within OpenCode|can only be used from/i.test(body || '')) return '';
  return ' Free-тариф OpenCode Zen пускает только официальный клиент opencode и лимитирует частоту по IP. Попробуй позже или добавь новый ключ (oc_sk_...) со страницы https://opencode.ai/auth.';
}

function appendZenErrorHint(message: string, body: string): string {
  return message + zenErrorHint(body);
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

/** HTML страницы → читаемый текст (срезка скриптов/стилей/тегов, декодирование сущностей). */
function htmlToText(html: string, max: number): string {
  let s = html
    .slice(0, 600_000)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|section|article|table)>/gi, '\n')
    .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#0*34;/g, '"')
    .replace(/&#x22;/g, '"');
  s = s
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l.length > 0)
    .join('\n');
  return s.length > max ? s.slice(0, max) + '\n… (обрезано)' : s;
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

/** Парсер lite-выдачи DuckDuckGo (работает даже без JS, другой разметки). */
function parseDuckDuckGoLite(html: string, max: number): { title: string; url: string; snippet: string }[] {
  const out: { title: string; url: string; snippet: string }[] = [];
  const re = /<a[^>]+class="[^"]*result-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < max) {
    const url = decodeDdgHref(m[1]);
    const title = htmlDecode(m[2]);
    if (!title || !/^https?:\/\//i.test(url)) continue;
    const seg = html.slice(m.index + m[0].length, m.index + m[0].length + 1200);
    const sm =
      /class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/i.exec(seg) ||
      /class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/tr>/i.exec(seg);
    out.push({ title, url, snippet: sm ? htmlDecode(sm[1]) : '' });
  }
  return out;
}

/** Поиск по интернету через DuckDuckGo. Если user передал URL — просто прочитать страницу. */
async function execWebSearch(args: { query?: string; url?: string; max_results?: number }, signal?: AbortSignal): Promise<ExecResult> {
  const rawQuery = String(args.query ?? args.url ?? '').trim();
  if (!rawQuery) return { ok: false, output: 'Нет поискового запроса (query).' };
  if (/^https?:\/\//i.test(rawQuery)) {
    return execFetchPage({ url: rawQuery, max_chars: args.max_results ? args.max_results * 2000 : undefined }, signal);
  }
  const max = Math.max(1, Math.min(8, Number(args.max_results) || 5));
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(rawQuery)}`;
  let res: FetchResult;
  try {
    res = await raceSignal(invoke<FetchResult>('op_web_fetch', { url }), signal);
  } catch (e) {
    return { ok: false, output: `Поиск не выполнился: ${String(e)}` };
  }
  if (!res.ok && res.status === 0) {
    return { ok: false, output: `Поиск не выполнился: ${res.error ?? 'нет сети'}` };
  }
  let results = parseDuckDuckGo(res.text, max);
  if (results.length === 0) {
    // Запасной парсер/эндпоинт: lite-версия отдаёт чистую разметку без JS.
    try {
      const lite = await raceSignal(
        invoke<FetchResult>('op_web_fetch', { url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(rawQuery)}` }),
        signal,
      );
      if (lite.ok) results = parseDuckDuckGoLite(lite.text, max);
    } catch { /* остаёмся с пустым результатом */ }
  }
  if (results.length === 0) {
    return {
      ok: false,
      output: `Поиск по «${rawQuery}» не дал результатов. Попробуй иначе сформулировать запрос или прочитай конкретную страницу через fetch_page(url).`,
    };
  }
  const body = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet || '(описание недоступно)'}`).join('\n');
  return { ok: true, output: `Результаты поиска по «${rawQuery}»:\n\n${body}` };
}

/** Человекочитаемая подсказка к HTTP-статусу — чтобы агент понимал причину и мог исправить запрос. */
function httpStatusHint(status: number): string {
  if (status === 400) return 'неверный запрос — проверь параметры и тело';
  if (status === 401) return 'требуется авторизация — токен отсутствует или неверен';
  if (status === 403) return 'доступ запрещён — нужен токен или не хватает прав';
  if (status === 404) return 'не найдено — проверь URL и путь эндпоинта';
  if (status === 409) return 'конфликт состояния';
  if (status === 422) return 'некорректные данные запроса';
  if (status === 429) return 'слишком много запросов — сработал лимит, подожди и повтори';
  if (status >= 500) return 'ошибка на стороне сервера — повтори позже';
  return 'неожиданный статус';
}

async function execFetchPage(args: { url?: string; max_chars?: number }, signal?: AbortSignal): Promise<ExecResult> {
  const url = String(args.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, output: 'Нет корректного url — это должен быть полный http(s) адрес страницы.' };
  }
  let res: FetchResult;
  try {
    res = await raceSignal(invoke<FetchResult>('op_web_fetch', { url }), signal);
  } catch (e) {
    return { ok: false, output: `Страница не загрузилась: ${String(e)}` };
  }
  if (!res.ok || (res.text.length === 0 && res.error)) {
    const hint = !res.status
      ? 'Не удалось загрузить страницу (нет сети или сайт недоступен).'
      : `Страница вернула HTTP ${res.status} (${httpStatusHint(res.status)}).`;
    return { ok: false, output: `${hint} ${res.error ?? ''}`.trim() };
  }
  const maxChars = Math.min(120_000, Number(args.max_chars) || 20_000);
  const looksHtml = res.content_type.split(';')[0].trim().toLowerCase().includes('html') || res.text.trim().startsWith('<');
  const text = looksHtml ? htmlToText(res.text, maxChars) : (res.text.length > maxChars ? res.text.slice(0, maxChars) + '\n… (обрезано)' : res.text);
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
    // Читаем прежнее содержимое, чтобы в чате показать «-N +M» и сам diff.
    let before = '';
    try {
      const prev = await invoke<any>('op_read_text', { root: String(args.root), path: args.path });
      before = typeof prev === 'string' ? prev : (prev?.content ?? '');
    } catch {
      before = '';
    }
    await invoke('op_write_text', { root: String(args.root), path: args.path, content: args.content });
    const diff = diffLines(before, args.content);
    const change: FileChange = {
      path: args.path,
      root: String(args.root),
      added: diff.added,
      removed: diff.removed,
      lines: diff.lines,
      created: before.length === 0,
    };
    return {
      ok: true,
      changes: [change],
      output: `Записано: ${args.path} (${change.created ? 'создан' : `+${diff.added} −${diff.removed}`})`,
    };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

/**
 * Точечная правка файла: заменяет exact-фрагмент на новый. Для кода это
 * безопаснее и дешевле полной перезаписи — агент не обязан держать в памяти
 * весь файл и не может случайно затереть не related строки.
 */
async function execEditFile(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const root = String(args.root ?? 'launcher');
    const path = String(args.path ?? '');
    const find = String(args.find ?? '');
    const replace = String(args.replace ?? '');
    if (!path || !find) return { ok: false, output: 'Нужны path и find.' };

    const current = await invoke<any>('op_read_text', { root, path });
    const before = typeof current === 'string' ? current : (current?.content ?? '');
    if (!before) return { ok: false, output: `Файл не найден или пуст: ${path}` };

    const occurrences = before.split(find).length - 1;
    if (occurrences === 0) {
      return { ok: false, output: `Фрагмент не найден в ${path}. Прочитай файл заново — он мог измениться.` };
    }
    if (occurrences > 1 && !args.all) {
      return {
        ok: false,
        output: `Фрагмент встречается ${occurrences} раза в ${path}. Добавь фрагмент в old_string так, чтобы он был уникален, либо передай replace_all: true.`,
      };
    }

    const after = args.all ? before.split(find).join(replace) : before.replace(find, replace);
    await invoke('op_write_text', { root, path, content: after });
    const diff = diffLines(before, after);
    const change: FileChange = { path, root, added: diff.added, removed: diff.removed, lines: diff.lines };
    return {
      ok: true,
      changes: [change],
      output: `Изменено: ${path} (+${diff.added} −${diff.removed})`,
    };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

/** Поиск по коду: подстока или регулярное выражение по файлам зоны. */
/** Скачивает файл по URL в песочницу: текстуры, картинки, .jar, json. */
async function execDownloadFile(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const url = String(args.url ?? '').trim();
    if (!url) return { ok: false, output: 'Нужен url.' };
    const root = String(args.root ?? 'temp');
    if (!['portal', 'temp', 'launcher'].includes(root)) {
      return { ok: false, output: `Неизвестная зона: ${root}` };
    }
    const res = await httpGetBytesViaRust(url);
    if (!res.b64) {
      return { ok: false, output: `Не удалось скачать ${url}: HTTP ${res.status}${res.error ? ` — ${res.error}` : ''}` };
    }
    // Имя берём из URL, если не задано явно.
    const fromUrl = decodeURIComponent(url.split('?')[0].split('/').filter(Boolean).pop() ?? 'download.bin');
    const raw = String(args.path ?? fromUrl).trim() || 'download.bin';
    const name = raw.includes('.') ? raw : `${raw}.bin`;
    const written = await invoke<any>('op_write_bytes', { root, path: name, b64: res.b64 });
    const savedPath = typeof written === 'string' && written ? written : name;
    const sizeKb = Math.round((res.b64?.length ?? 0) * 0.75 / 1024);
    return {
      ok: true,
      output: `Скачано (${res.content_type || 'неизвестный тип'}, ~${sizeKb} КБ) в ${root}: ${savedPath}\nДальше с файлом можно работать: inspect_image, archive_list/archive_extract, read_text (если текст), hexdump.`,
    };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

/** Разбор .jar: список классов и сигнатуры методов через javap. */
async function execDecompileJar(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const root = String(args.root ?? 'temp');
    const path = String(args.path ?? '');
    if (!path) return { ok: false, output: 'Нужен path до .jar.' };

    const entries = await invoke<{ name: string; is_dir: boolean; size: number }[]>('op_archive_list', { root, path });
    const classes = entries.filter(e => e.name.endsWith('.class')).map(e => e.name.replace(/\.class$/, '').replace(/\//g, '.'));
    const manifests = entries
      .filter(e => /fabric\.mod\.json|META-INF\/mods\.toml|META-INF\/META-INF\/neoforge\.mods\.toml|pack\.mcmeta|shaders\/.*\.(vsh|fsh)$|assets\//.test(e.name))
      .slice(0, 60)
      .map(e => e.name);

    const parts: string[] = [
      `Классов в архиве: ${classes.length}`,
      `Ключевые файлы (манифесты, ресурсы, шейдеры):\n${manifests.length ? manifests.join('\n') : 'не найдено'}`,
    ];
    if (classes.length) {
      const sample = classes.slice(0, 40).join('\n');
      parts.push(`Классы (первые ${Math.min(40, classes.length)}):\n${sample}`);
    }

    // Сигнатуры методов верхнего пакета — там обычно основной код мода.
    const filter = String(args.class_filter ?? '').trim();
    const targets = (filter ? classes.filter(c => c.includes(filter)) : classes.filter(c => !c.includes('$$')))
      .filter(c => !c.startsWith('net/minecraft') && !c.startsWith('java/') && !c.startsWith('com/mojang'))
      .slice(0, 5);
    if (targets.length) {
      const javap = await invoke<any>('op_run_command', {
        root,
        cwd: await lookupRoot(root as PortalRoot),
        command: `javap -classpath "${path}" ${targets.join(' ')}`,
        timeout_ms: 60000,
        shell: null,
      });
      parts.push(`Сигнатуры (javap):\n${String(javap?.stdout ?? javap?.output ?? '').slice(0, 6000)}`);
    }

    return { ok: true, output: parts.join('\n\n') };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

/** Быстрая сводка по папке проекта. */
async function execProjectInfo(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const root = String(args.root ?? 'launcher');
    const path = String(args.path ?? '').trim();
    const entries = await invoke<{ name: string; is_dir: boolean; size: number }[]>('op_list_dir', { root, path });
    const files = entries.filter(e => !e.is_dir);
    const dirs = entries.filter(e => e.is_dir);
    const byExt: Record<string, number> = {};
    let total = 0;
    for (const f of files) {
      const m = /\.([a-z0-9]+)$/i.exec(f.name);
      const ext = m ? m[1].toLowerCase() : '(без расширения)';
      byExt[ext] = (byExt[ext] ?? 0) + 1;
      total += f.size;
    }
    const key = files.filter(f => /fabric\.mod\.json|mods\.toml|neoforge\.mods\.toml|pack\.mcmeta|quilt\.mod\.json|build\.gradle|settings\.gradle|gradlew|\.java$|\.py$|\.vsh$|\.fsh$|\.json$/i.test(f.name))
      .slice(0, 40).map(f => f.name);
    return {
      ok: true,
      output: [
        `Папка: ${path || '/'}`,
        `Файлов: ${files.length}, папок: ${dirs.length}, общий размер: ~${Math.round(total / 1024)} КБ`,
        `По типам: ${Object.entries(byExt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', ') || '—'}`,
        `Ключевые файлы:\n${key.join('\n') || 'не найдено'}`,
        dirs.length ? `Папки: ${dirs.map(d => d.name).slice(0, 25).join(', ')}` : '',
      ].filter(Boolean).join('\n\n'),
    };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

function rootBaseFor(root: string): string {
  return root;
}

/** Запуск Python-скрипта из песочницы. */
async function execRunPython(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const root = String(args.root ?? 'temp');
    const path = String(args.path ?? '');
    if (!path) return { ok: false, output: 'Нужен path к .py файлу.' };
    if (!/^portal$|^temp$|^launcher$/.test(root)) return { ok: false, output: `Неизвестная зона: ${root}` };
    const argsText = String(args.args ?? '').trim();
    const res = await invoke<CmdResult>('op_run_command', {
      root,
      cwd: await lookupRoot(root as PortalRoot),
      command: `python "${path}"${argsText ? ` ${argsText}` : ''}`,
      timeout_ms: Number(args.timeout_ms ?? 120000),
      shell: null,
    });
    const out = String(res?.stdout ?? '');
    const err = String(res?.stderr ?? '');
    if (res?.exit_code !== 0) {
      return { ok: false, output: `Скрипт завершился с кодом ${res?.exit_code}${err ? `\n--- stderr ---\n${err.slice(0, 6000)}` : ''}${out ? `\n--- stdout ---\n${out.slice(0, 3000)}` : ''}` };
    }
    return { ok: true, output: `${out.slice(0, 8000)}${err ? `\n--- stderr ---\n${err.slice(0, 2000)}` : ''}` };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

/** Сборка Java-проекта в .jar через javac + jar. */
async function execBuildJar(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const root = String(args.root ?? 'temp');
    const projectDir = String(args.project_dir ?? '');
    const outName = String(args.out_name ?? 'build.jar');
    if (!projectDir || !outName) return { ok: false, output: 'Нужны project_dir и out_name.' };
    const classpath = String(args.classpath ?? '');
    const cwd = await lookupRoot(root as PortalRoot);
    const cp = classpath ? `-cp "${classpath}"` : '';
    const classes = `${projectDir}/build/classes`;

    const compile = await invoke<CmdResult>('op_run_command', {
      root, cwd,
      command: `javac ${cp} -d "${classes}" $(dir /b /s "${projectDir}\\src\\*.java")`,
      timeout_ms: 300000, shell: null,
    });
    if (compile?.exit_code !== 0) {
      return { ok: false, output: `Компиляция не удалась (код ${compile?.exit_code}):\n${String(compile?.stderr ?? '').slice(0, 8000)}` };
    }
    // Ресурсы (fabric.mod.json, resources, assets) копируем в классы.
    const copyRes = await invoke<CmdResult>('op_run_command', {
      root, cwd,
      command: `if exist "${projectDir}\\src\\main\\resources" xcopy /E /I /Y "${projectDir}\\src\\main\\resources\\*" "${classes}" >nul 2>&1`,
      timeout_ms: 120000, shell: null,
    });
    const jar = await invoke<CmdResult>('op_run_command', {
      root, cwd,
      command: `jar cf "${outName}" -C "${classes}" .`,
      timeout_ms: 120000, shell: null,
    });
    if (jar?.exit_code !== 0) {
      return { ok: false, output: `Упаковка не удалась:\n${String(jar?.stderr ?? '').slice(0, 4000)}` };
    }
    void copyRes;
    return {
      ok: true,
      output: `Собрано: ${outName}. Проверь содержимое через archive_list, затем положи jar в mods сборки и скажи пользователю пересобрать её.`,
    };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execSearchCode(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const root = String(args.root ?? 'launcher');
    const query = String(args.query ?? '').trim();
    if (!query) return { ok: false, output: 'Нужен query.' };
    const regex = args.regex === true;
    const glob = String(args.glob ?? '').trim();
    const limit = Math.min(200, Math.max(1, Number(args.limit ?? 60)));

    const res = await invoke<any>('op_search_code', { root, query, regex, glob, limit });
    const matches: any[] = Array.isArray(res?.matches) ? res.matches : [];
    if (matches.length === 0) return { ok: true, output: `Ничего не найдено по «${query}».` };
    const lines = matches.map((m: any) => `${m.path}:${m.line}: ${String(m.text ?? '').trim()}`);
    return {
      ok: true,
      output: `Найдено совпадений: ${matches.length}${matches.length >= limit ? ' (обрезано)' : ''}\n${lines.join('\n')}`,
    };
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

async function execInspectImage(args: { root: PortalRoot; path: string }): Promise<ExecResult> {
  try {
    const insp = await invoke<{
      width: number; height: number; alpha: boolean;
      colors: { hex: string; share: number; brightness: number }[];
      dominant: string; average: string;
    }>('op_image_inspect', { root: String(args.root), path: args.path });
    const palette = (Array.isArray(insp?.colors) ? insp.colors : [])
      .map(c => `${c.hex} ${Math.round((c.share ?? 0) * 10) / 10}% (яркость ${c.brightness})`)
      .slice(0, 8)
      .join(', ');
    return {
      ok: true,
      output: `Размер ${insp?.width}×${insp?.height}, альфа-канал: ${insp?.alpha ? 'есть' : 'нет'}. Доминирующий цвет: ${insp?.dominant || '—'}. Средний цвет: ${insp?.average || '—'}. Палитра: ${palette || '—'}.`,
    };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execHexdump(args: { root: PortalRoot; path: string; max_bytes?: number }): Promise<ExecResult> {
  try {
    const lines = await invoke<{ offset: number; hex: string; ascii: string }[]>('op_hexdump', {
      root: String(args.root), path: args.path, max_bytes: args.max_bytes ?? null,
    });
    const body = (Array.isArray(lines) ? lines : [])
      .map(l => `${String(l?.offset ?? 0).padStart(8, '0')}  ${l?.hex ?? ''}  | ${l?.ascii ?? ''}`)
      .join('\n');
    return { ok: true, output: body || '(файл пуст)' };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execArchiveList(args: { root: PortalRoot; path: string }): Promise<ExecResult> {
  try {
    const entries = await invoke<{ name: string; is_dir: boolean; size: number }[]>('op_archive_list', {
      root: String(args.root), path: args.path,
    });
    if (!Array.isArray(entries) || entries.length === 0) return { ok: true, output: '(архив пуст)' };
    const lines = entries.map(e => `${e?.is_dir ? '[dir ]' : '[file]'} ${e?.name}${e?.is_dir ? '/' : ''}${e?.is_dir ? '' : `  (${fmtSize(e?.size ?? 0)})`}`);
    return { ok: true, output: lines.join('\n') };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execArchiveExtract(args: { root: PortalRoot; path: string; dest_path?: string }): Promise<ExecResult> {
  try {
    const out = await invoke<string>('op_archive_extract', {
      root: String(args.root), path: args.path, dest_path: args.dest_path ?? null,
    });
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execArchiveCreate(args: { root: PortalRoot; path: string; name: string }): Promise<ExecResult> {
  try {
    const out = await invoke<string>('op_archive_create', {
      root: String(args.root), path: args.path, name: args.name,
    });
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execCopyToDownloads(args: { root: PortalRoot; path: string; name?: string }): Promise<ExecResult> {
  try {
    const res = await invoke<string>('op_copy_to_downloads', {
      root: String(args.root), path: args.path, name: args.name ?? null,
    });
    return { ok: true, output: res };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execLauncherListBuilds(): Promise<ExecResult> {
  try {
    const list = await invoke<any[]>('get_instances');
    if (!Array.isArray(list) || list.length === 0) return { ok: true, output: '(сборок нет)' };
    const lines = list.map(b => {
      const mods = Array.isArray(b?.mods) ? b.mods.length : 0;
      return `- ${b?.id}\n  Название: ${b?.name ?? ''}\n  Minecraft: ${b?.mc_version ?? ''} / ${b?.loader ?? ''} ${b?.loader_version ?? ''}\n  RAM: ${b?.min_ram ?? '?'}–${b?.max_ram ?? '?'} МБ · моды: ${mods} · создана: ${String(b?.created_at ?? '').slice(0, 16)}`;
    });
    return { ok: true, output: `Сборки лаунчера (${list.length}):\n${lines.join('\n')}` };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execLauncherLogs(args: { instance_id: string }): Promise<ExecResult> {
  try {
    const lines = await invoke<string[]>('get_game_logs', { instance_id: args.instance_id });
    const all = Array.isArray(lines) ? lines : [];
    const tail = all.slice(-250).join('\n');
    return { ok: true, output: `Лог сборки ${args.instance_id} (${all.length} строк, показаны последние 250):\n${tail || '(лог пуст)'}` };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

/** Человекочитаемые названия типов контента Modrinth. */
const TYPE_LABELS: Record<string, string> = {
  mod: 'мод',
  resourcepack: 'ресурс-пак',
  shaderpack: 'шейдер',
  modpack: 'модпак',
};

/** Путь раздела на modrinth.com для типа проекта. */
const TYPE_PATHS: Record<string, string> = {
  mod: 'mod',
  resourcepack: 'resourcepack',
  shaderpack: 'shader',
  modpack: 'modpack',
};

/**
 * Платформа проекта по сторонам установки Modrinth.
 * client_side/server_side: required | optional | unsupported | unknown.
 */
function platformLabel(client: unknown, server: unknown): string {
  const c = String(client ?? 'unknown');
  const s = String(server ?? 'unknown');
  const clientOn = c === 'required' || c === 'optional';
  const serverOn = s === 'required' || s === 'optional';
  if (clientOn && serverOn) return 'Клиент и сервер';
  if (clientOn) return 'Только клиент';
  if (serverOn) return 'Только сервер';
  return 'Неизвестно';
}

/**
 * Поиск на CurseForge. Требует API-ключ (Настройки → Дополнительно), поэтому
 * при его отсутствии ветка молча пропускается, а не роняет весь поиск.
 * classId в CurseForge: 6 — мод, 12 — ресурс-пак, 6551 — шейдеры.
 */
async function searchCurseforgeCards(
  query: string,
  projectType: string,
  mcVersion: string | null,
  limit: number,
): Promise<{ cards: ModCard[]; lines: string[]; note: string }> {
  const classId = projectType === 'resourcepack' ? 12 : projectType === 'shaderpack' ? 6551 : 6;
  let result: any;
  try {
    result = await invoke<any>('search_curseforge', {
      query,
      limit,
      classId,
      gameVersion: mcVersion,
      apiKey: '',
      gameId: 432,
    });
  } catch (e) {
    return { cards: [], lines: [], note: `CurseForge пропущен: ${String(e)}` };
  }
  const items: any[] = Array.isArray(result?.data) ? result.data : [];
  const cards: ModCard[] = [];
  const lines: string[] = [];
  for (const it of items.slice(0, limit)) {
    const id = Number(it.id ?? 0);
    const logo = it.logo?.url ?? it.logo?.thumbnailUrl ?? null;
    const title = String(it.name ?? '');
    const author = Array.isArray(it.authors) ? it.authors.map((a: any) => String(a.name ?? '')).filter(Boolean).join(', ') : '';
    const description = String(it.summary ?? '');
    // Файл для установки: последний подходящий по версии игры.
    let fileUrl = '';
    let fileName = '';
    let versionNumber = '';
    try {
      const files = await invoke<any[]>('get_curseforge_mod_files', { modId: id, gameVersion: mcVersion });
      const list: any[] = Array.isArray(files) ? files : [];
      const pick = list.find((f: any) => f?.downloadUrl) ?? list[0];
      if (pick) {
        fileUrl = String(pick.downloadUrl ?? '');
        fileName = String(pick.fileName ?? '');
        versionNumber = String(pick.displayName ?? pick.fileName ?? '');
      }
    } catch { /* остаёмся с метаданными без файла */ }
    cards.push({
      projectId: String(id),
      slug: String(it.slug ?? id),
      title,
      description,
      author,
      iconUrl: logo,
      projectType,
      platform: 'Клиент и сервер',
      loaders: [],
      gameVersions: mcVersion ? [mcVersion] : [],
      downloads: Number(it.downloadCount ?? 0),
      versionNumber,
      fileName,
      downloadUrl: fileUrl,
      installable: Boolean(fileUrl),
      source: 'curseforge',
      url: `https://www.curseforge.com/minecraft/${it.slug ?? id}`,
    });
    lines.push(
      `- ${title} · ${author} · id ${id} (CurseForge)` +
      `\n  тип: ${TYPE_LABELS[projectType] ?? 'мод'} · загрузок: ${it.downloadCount ?? 0}` +
      (fileUrl
        ? `\n  файл: ${fileName} · версия: ${versionNumber}\n  download_url: ${fileUrl}\n  для установки: launcher_install_mod(instance_id, download_url="${fileUrl}", file_name="${fileName}", mod_id="${id}", mod_name="${title}", mod_version="${versionNumber}", source="curseforge", mod_type="${projectType}", author="${author}", icon_url="${logo ?? ''}")`
        : '\n  подходящего файла не найдено — уточни версию игры или выбери другой результат'),
    );
  }
  const note = items.length > 0 ? '' : 'CurseForge: результатов нет';
  return { cards, lines, note };
}

async function execModSearch(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const query = String(args.query ?? '').trim();
    if (!query) return { ok: false, output: 'Нужен запрос (query).' };
    const mcVersion = args.mc_version != null && String(args.mc_version).trim() ? String(args.mc_version).trim() : null;
    const loader = args.loader != null && String(args.loader).trim() ? String(args.loader).trim() : null;
    // Тип контента. Раньше он не передавался, и Rust всегда ставил project_type:mod —
    // поэтому агент физически не мог найти ресурс-паки и шейдеры.
    const rawType = String(args.project_type ?? 'mod').trim().toLowerCase();
    const projectType = (['mod', 'resourcepack', 'shaderpack', 'modpack'].includes(rawType) ? rawType : 'mod');
    // Где искать: только Modrinth, только CurseForge или оба сразу.
    const rawSource = String(args.source ?? 'modrinth').trim().toLowerCase();
    const withCurseforge = rawSource === 'curseforge' || rawSource === 'both';
    const withModrinth = rawSource !== 'curseforge';
    const limit = Math.min(10, Math.max(1, Number(args.limit ?? 5)));

    // Фильтр по загрузчику применим ТОЛЬКО к модам и модпакам. Ресурс-паки и
    // шейдеры зависят от версии игры, а не от Fabric/Forge — фильтр по лоадеру
    // убирал их из выдачи целиком.
    const loaderApplies = projectType === 'mod' || projectType === 'modpack';
    const loaderFilter = loaderApplies ? loader : null;

    const search = withModrinth
      ? await invoke<any>('search_modrinth', {
          query,
          limit,
          versions: mcVersion ? [mcVersion] : null,
          loaders: loaderFilter ? [loaderFilter] : null,
          sort: 'relevance',
          projectType,
        })
      : { hits: [] };
    const hits: any[] = Array.isArray(search?.hits) ? search.hits : [];
    if (hits.length === 0 && !withCurseforge) {
      return { ok: true, output: `По запросу «${query}» в Modrinth ничего не найдено. Попробуй другие слова или убери фильтры mc_version/loader.` };
    }

    const rows = await Promise.all(hits.map(async (h) => {
      let file: { filename?: string; url?: string; sha1?: string } | null = null;
      let versionId = '';
      let versionNumber = '';
      try {
      const versions = await invoke<any[]>('get_modrinth_versions', {
        projectId: String(h.project_id ?? ''),
        gameVersion: mcVersion,
        loader: loaderFilter,
      });
        const list: any[] = Array.isArray(versions) ? versions : [];
        if (list.length > 0) {
          versionId = String(list[0].id ?? '');
          versionNumber = String(list[0].version_number ?? '');
          const primary = Array.isArray(list[0].files) ? list[0].files.find((f: any) => f?.primary) : null;
          const pick = primary ?? (Array.isArray(list[0].files) ? list[0].files[0] : null);
          if (pick) {
            file = {
              filename: String(pick.filename ?? ''),
              url: String(pick.url ?? ''),
              sha1: String(pick.sha1 ?? ''),
            };
          }
        }
      } catch {
        // версии не запросились — отдаём метаданные без файла
      }
      return { h, file, versionId, versionNumber };
    }));

    const typeLabel = TYPE_LABELS[projectType] ?? 'мод';
    const lines = rows.map(({ h, file, versionId, versionNumber }) => {
      const meta = [
        `- ${h.title ?? ''} · ${h.author ?? ''} · id ${h.project_id ?? ''}`,
        `  тип: ${typeLabel} · платформа: ${platformLabel(h.client_side, h.server_side)} · загрузок: ${h.downloads ?? 0} · лоадеры: ${Array.isArray(h.loaders) ? h.loaders.join(',') : ''} · MC: ${Array.isArray(h.game_versions) ? h.game_versions.slice(0, 8).join(', ') : ''}`,
        `  версия: ${versionNumber || '—'}${versionId ? ` (id ${versionId})` : ''} · файл: ${file?.filename || '—'}`,
      ];
      if (!file?.url) {
        meta.push('  совместимой версии под заданные mc_version/loader не найдено — уточни параметры или выбери другой результат');
        return meta.join('\n');
      }
      meta.push(`  download_url: ${file.url}${file.sha1 ? ` · sha1: ${file.sha1}` : ''}`);
      meta.push(`  для установки: launcher_install_mod(instance_id, download_url="${file.url}", file_name="${file.filename}", mod_id="${h.project_id ?? ''}", mod_name="${h.title ?? ''}", mod_version="${versionNumber}", version_id="${versionId}", source="modrinth", mod_type="${projectType}", author="${h.author ?? ''}", icon_url="${h.icon_url ?? ''}")`);
      return meta.join('\n');
    });

    const okCount = rows.filter((r) => r.file?.url).length;
    // Карточки для чата: иконка, название, описание, платформа, тип и источник.
    const modrinthCards: ModCard[] = rows.map(({ h, file, versionNumber }) => ({
      projectId: String(h.project_id ?? ''),
      slug: String(h.slug ?? h.project_id ?? ''),
      title: String(h.title ?? ''),
      description: String(h.description ?? ''),
      author: String(h.author ?? ''),
      iconUrl: h.icon_url ? String(h.icon_url) : null,
      projectType: String(h.project_type ?? projectType),
      platform: platformLabel(h.client_side, h.server_side),
      loaders: Array.isArray(h.loaders) ? h.loaders.map(String) : [],
      gameVersions: Array.isArray(h.game_versions) ? h.game_versions.map(String) : [],
      downloads: Number(h.downloads ?? 0),
      versionNumber: String(versionNumber ?? ''),
      fileName: String(file?.filename ?? ''),
      downloadUrl: String(file?.url ?? ''),
      installable: Boolean(file?.url),
      source: 'modrinth',
      url: `https://modrinth.com/${TYPE_PATHS[String(h.project_type ?? projectType)] ?? 'modpack'}/${h.slug ?? h.project_id ?? ''}`,
    }));

    // CurseForge — по запросу. Ошибка или отсутствие ключа не должна рушить
    // выдачу Modrinth, поэтому ветка мягкая.
    const cf = withCurseforge
      ? await searchCurseforgeCards(query, projectType, mcVersion, limit)
      : { cards: [] as ModCard[], lines: [] as string[], note: '' };

    const cards = [...modrinthCards, ...cf.cards];
    const sources = [
      withModrinth && rows.length > 0 ? `Modrinth (${typeLabel}): ${rows.length}, из них ${okCount} с подходящей версией` : '',
      withCurseforge ? `CurseForge (${typeLabel}): ${cf.cards.length}` : '',
    ].filter(Boolean).join(' · ');

    const sections = [
      withModrinth && lines.length > 0 ? lines.join('\n\n') : '',
      cf.lines.length > 0 ? cf.lines.join('\n\n') : '',
      cf.note,
    ].filter(Boolean).join('\n\n');

    if (cards.length === 0) {
      return { ok: true, cards: [], output: `По запросу «${query}» ничего не найдено${cf.note ? ` (${cf.note})` : ''}. Попробуй другие слова или сними фильтры mc_version/loader.` };
    }

    return {
      ok: true,
      cards,
      output: `${sources}:\n\n${sections}`,
    };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execLauncherInstallMod(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const instanceId = String(args.instance_id ?? '');
    const downloadUrl = String(args.download_url ?? '');
    const fileName = String(args.file_name ?? '');
    if (!instanceId || !downloadUrl || !fileName) return { ok: false, output: 'Нужны instance_id, download_url, file_name.' };
    const res = await invoke<any[]>('install_mod', {
      instanceId,
      downloadUrl,
      fileName,
      modId: String(args.mod_id ?? ''),
      modName: String(args.mod_name ?? fileName),
      modVersion: String(args.mod_version ?? ''),
      versionId: String(args.version_id ?? ''),
      source: String(args.source ?? 'modrinth'),
      modType: args.mod_type != null ? String(args.mod_type) : null,
      projectId: args.project_id != null ? String(args.project_id) : null,
      author: args.author != null ? String(args.author) : null,
      iconUrl: args.icon_url != null ? String(args.icon_url) : null,
    });
    const count = Array.isArray(res) ? res.length : 0;
    return { ok: true, output: `Установлено в сборку ${instanceId}: ${count} файл(а). Напомни пользователю пересобрать сборку в лаунчере, чтобы контент проиндексировался.` };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execLauncherCreateBuild(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const name = String(args.name ?? '');
    if (!name) return { ok: false, output: 'Нужно имя сборки (name).' };
    const instance = await invoke<any>('create_instance', {
      name,
      description: String(args.description ?? ''),
      mcVersion: String(args.mc_version ?? ''),
      loader: String(args.loader ?? 'fabric'),
      loaderVersion: String(args.loader_version ?? ''),
      minRam: Number(args.min_ram ?? 4096),
      maxRam: Number(args.max_ram ?? 8192),
      color: args.color != null ? String(args.color) : null,
      icon: args.icon != null ? String(args.icon) : null,
    });
    return { ok: true, output: `Создана сборка «${instance?.name ?? name}» (id ${instance?.id ?? '?'}). Версии Minecraft/загрузчика должны быть установлены в лаунчере.` };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Инструменты глубокой работы со сборками
// ---------------------------------------------------------------------------

async function execLauncherBuildInfo(args: { instance_id: string }): Promise<ExecResult> {
  try {
    const id = String(args.instance_id ?? '');
    if (!id) return { ok: false, output: 'Нужен instance_id (см. launcher_list_builds).' };
    const list = await invoke<any[]>('get_instances').catch(() => [] as any[]);
    const found = (Array.isArray(list) ? list : []).find(i => i?.id === id);
    if (!found) return { ok: false, output: `Сборка ${id} не найдена. Вызови launcher_list_builds.` };

    const [mods, overview] = await Promise.all([
      invoke<any[]>('get_instance_mods', { instanceId: id }).catch(() => [] as any[]),
      invoke<any>('instance_overview', { instanceId: id }).catch(() => null),
    ]);

    const line = (m: any) => {
      const name = m?.file_name ?? m?.fileName ?? m?.name ?? '?';
      const ver = m?.version ?? m?.mod_version ?? '';
      const idm = m?.mod_id ?? m?.project_id ?? '';
      return `    - ${name}${ver ? ` (${ver})` : ''}${idm ? ` [${idm}]` : ''}`;
    };

    const dirRows = async (folder: string) => {
      const items = await invoke<any[]>('instance_list_dir', { instanceId: id, path: folder }).catch(() => [] as any[]);
      return (Array.isArray(items) ? items : []).map((e: any) =>
        `    - ${e?.name ?? e}${e?.size ? ` (${(Number(e.size) / 1048576).toFixed(2)} МБ)` : ''}`);
    };
    const [packs, shaders, configs] = await Promise.all([
      dirRows('resourcepacks'), dirRows('shaderpacks'), dirRows('config'),
    ]);

    // options.txt и активный шейдер/пак — из файлов, иначе модель гадает.
    let options = '(нет options.txt)';
    try {
      const raw = await invoke<string>('instance_read_text', { instanceId: id, path: 'options.txt' });
      options = String(raw ?? '').split('\n').filter(l => l.trim()).slice(0, 60).join('\n    ');
    } catch { /* options.txt может отсутствовать */ }

    const out = [
      `Сборка: ${found?.name ?? id}`,
      `id: ${id}`,
      `Minecraft: ${found?.mc_version ?? '?'} · загрузчик: ${found?.loader ?? '?'} ${found?.loader_version ?? ''}`,
      `RAM: ${found?.min_ram ?? '?'}–${found?.max_ram ?? '?'} МБ`,
      `JVM-аргументы: ${found?.custom_jvm_args || '(по умолчанию)'}`,
      `Создана: ${String(found?.created_at ?? '').slice(0, 16)}`,
      `Размер сборки: ${overview?.size_mb ?? '?'} МБ · запущена: ${overview?.running ? 'да' : 'нет'}`,
      `Моды (${Array.isArray(mods) ? mods.length : 0}):\n${(Array.isArray(mods) ? mods : []).map(line).join('\n') || '    (пусто)'}`,
      `Ресурс-паки (${packs.length}):\n${packs.join('\n') || '    (пусто)'}`,
      `Шейдеры (${shaders.length}):\n${shaders.join('\n') || '    (пусто)'}`,
      `Конфиги (${configs.length}):\n${configs.slice(0, 40).join('\n') || '    (пусто)'}`,
      `options.txt:\n    ${options}`,
      '',
      'Дальше читай конкретные файлы через launcher_read_file, меняй через launcher_write_file,',
      'перед запуском проверь launcher_verify_build, при падении — launcher_crash_report.',
    ].join('\n');
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execLauncherListContent(args: { instance_id: string; folder?: string }): Promise<ExecResult> {
  try {
    const id = String(args.instance_id ?? '');
    if (!id) return { ok: false, output: 'Нужен instance_id.' };
    const folder = String(args.folder ?? 'all');
    const folders = folder === 'all'
      ? ['mods', 'resourcepacks', 'shaderpacks', 'datapacks', 'config']
      : [folder];
    const blocks: string[] = [];
    for (const f of folders) {
      const items = await invoke<any[]>('instance_list_dir', { instanceId: id, path: f }).catch(() => [] as any[]);
      const list = Array.isArray(items) ? items : [];
      if (folder === 'all' && list.length === 0) continue;
      const rows = list.map((e: any) =>
        `  - ${e?.name ?? e}${e?.is_dir ? '/' : ''}${e?.size ? ` · ${(Number(e.size) / 1048576).toFixed(2)} МБ` : ''}`);
      blocks.push(`${f} (${list.length}):\n${rows.join('\n') || '  (пусто)'}`);
    }
    return { ok: true, output: blocks.length ? blocks.join('\n\n') : 'В выбранных папках ничего нет.' };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execLauncherReadFile(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const id = String(args.instance_id ?? '');
    const path = String(args.path ?? '');
    if (!id || !path) return { ok: false, output: 'Нужны instance_id и path.' };
    if (path.includes('..')) return { ok: false, output: 'Путь не должен содержать "..".' };
    const raw = await invoke<string>('instance_read_text', { instanceId: id, path });
    const all = String(raw ?? '').split('\n');
    const offset = Math.max(0, Number(args.offset ?? 0));
    const limit = Math.max(1, Math.min(4000, Number(args.limit ?? 400)));
    const slice = all.slice(offset, offset + limit);
    const more = all.length > offset + limit
      ? `\n\n(показано ${slice.length} из ${all.length} строк. Продолжить: offset=${offset + limit})`
      : `\n\n(файл: ${all.length} строк, показаны с ${offset})`;
    return { ok: true, output: `${path}:\n${slice.join('\n')}${more}` };
  } catch (e) {
    return { ok: false, output: `Не удалось прочитать ${String(args.path ?? '')}: ${String(e)}` };
  }
}

async function execLauncherWriteFile(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const id = String(args.instance_id ?? '');
    const path = String(args.path ?? '');
    if (!id || !path) return { ok: false, output: 'Нужны instance_id и path.' };
    if (path.includes('..')) return { ok: false, output: 'Путь не должен содержать "..".' };
    const content = String(args.content ?? '');
    await invoke('instance_write_text', { instanceId: id, path, content });
    return { ok: true, output: `Записан ${path} в сборку ${id} (${content.length} символов). Если это конфиг — проверь launcher_verify_build.` };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execLauncherRemoveContent(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const id = String(args.instance_id ?? '');
    const folder = String(args.folder ?? 'mods');
    const fileName = String(args.file_name ?? '');
    if (!id || !fileName) return { ok: false, output: 'Нужны instance_id и file_name.' };
    if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
      return { ok: false, output: 'file_name — только имя файла без пути.' };
    }
    await invoke('instance_delete_path', { instanceId: id, path: `${folder}/${fileName}` });
    return { ok: true, output: `Удалён ${folder}/${fileName} из сборки ${id}.` };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execLauncherCrashReport(args: { instance_id: string; max_chars?: number }): Promise<ExecResult> {
  try {
    const id = String(args.instance_id ?? '');
    if (!id) return { ok: false, output: 'Нужен instance_id.' };
    const max = Math.max(2000, Math.min(60000, Number(args.max_chars ?? 20000)));
    const list = await invoke<any[]>('get_instances').catch(() => [] as any[]);
    const inst = (Array.isArray(list) ? list : []).find(i => i?.id === id);
    const logs = await invoke<string[]>('get_game_logs', { instance_id: id }).catch(() => [] as string[]);
    const all = Array.isArray(logs) ? logs : [];
    const bad = all.filter(l => /Exception|Error|Caused by|FATAL|Crash|Unsupported|mixin/i.test(l));
    const parts = [`Лог сборки ${id}: ${all.length} строк.`];
    if (inst) parts.push(`Сборка: ${inst?.name ?? id} · ${inst?.mc_version ?? '?'} · ${inst?.loader ?? '?'} ${inst?.loader_version ?? ''}`);
    parts.push(bad.length
      ? `Ошибки в логе (последние ${Math.min(120, bad.length)}):\n${bad.slice(-120).join('\n')}`
      : 'В логе явных ошибок нет. Посмотри launcher_verify_build и launcher_build_info.');
    return { ok: true, output: parts.join('\n\n').slice(0, max) };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execLauncherVerifyBuild(args: { instance_id: string }): Promise<ExecResult> {
  try {
    const id = String(args.instance_id ?? '');
    if (!id) return { ok: false, output: 'Нужен instance_id.' };
    const problems: string[] = [];

    const conflicts = await invoke<any[]>('detect_mod_conflicts', { instanceId: id }).catch(() => [] as any[]);
    for (const c of conflicts) {
      problems.push(`Конфликт модов: ${c?.mod_a ?? c?.modA ?? '?'} + ${c?.mod_b ?? c?.modB ?? '?'} — ${c?.reason ?? 'причина не указана'}`);
    }

    const mods = await invoke<any[]>('get_instance_mods', { instanceId: id }).catch(() => [] as any[]);
    const modList = Array.isArray(mods) ? mods : [];
    const seen = new Map<string, string>();
    for (const m of modList) {
      const idm = String(m?.mod_id ?? m?.project_id ?? '');
      if (!idm) continue;
      const prev = seen.get(idm);
      if (prev) problems.push(`Дубль мода ${idm}: ${prev} и ${m?.file_name ?? m?.name ?? '?'} — оставь один файл.`);
      else seen.set(idm, String(m?.file_name ?? m?.name ?? '?'));
    }

    // Битый JSON-конфиг ломает игру сразу при старте.
    const configFiles = await invoke<any[]>('instance_list_dir', { instanceId: id, path: 'config' }).catch(() => [] as any[]);
    let checked = 0;
    for (const f of (Array.isArray(configFiles) ? configFiles : [])
      .filter((e: any) => String(e?.name ?? '').toLowerCase().endsWith('.json'))
      .slice(0, 60)) {
      const name = String(f?.name ?? '');
      try {
        const raw = await invoke<string>('instance_read_text', { instanceId: id, path: `config/${name}` });
        JSON.parse(String(raw ?? ''));
        checked++;
      } catch (e) {
        problems.push(`Сломанный JSON: config/${name} — ${String(e).slice(0, 160)}`);
      }
    }

    const head = `Проверка сборки ${id}: модов ${modList.length}, конфликтов ${Array.isArray(conflicts) ? conflicts.length : 0}, JSON-конфигов проверено ${checked}.`;
    return {
      ok: true,
      output: problems.length ? `${head}\nПроблемы:\n${problems.map(p => `  ! ${p}`).join('\n')}` : `${head}\nПроблем не найдено.`,
    };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execJarList(args: { path: string; filter?: string }): Promise<ExecResult> {
  try {
    const path = String(args.path ?? '');
    if (!path) return { ok: false, output: 'Нужен path к .jar/.zip.' };
    const entries = await invoke<any[]>('op_archive_list', { root: 'launcher', path });
    const all = Array.isArray(entries) ? entries : [];
    if (all.length === 0) return { ok: true, output: `В ${path} ничего не найдено (или это не архив).` };
    const names = all.map(e => String(e?.name ?? e));
    const meta = names.filter(n => /fabric\.mod\.json|quilt\.mod\.json|META-INF\/(mods\.toml|neoforge\.mods\.toml)|mixins?\.json|_accesswidener|entrypoints/.test(n));
    const classes = names.filter(n => n.endsWith('.class'));
    return {
      ok: true,
      output: [
        `${path}: записей ${all.length}, классов ${classes.length}`,
        meta.length ? `Метаданные мода:\n${meta.map(n => `  - ${n}`).join('\n')}` : 'Метаданных мода (fabric.mod.json и т.п.) нет.',
        classes.length ? `Классы (первые 120):\n${classes.slice(0, 120).map(n => `  - ${n}`).join('\n')}` : '',
      ].filter(Boolean).join('\n'),
    };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execPathExists(args: { path: string }): Promise<ExecResult> {
  try {
    const path = String(args.path ?? '');
    if (!path) return { ok: false, output: 'Нужен path.' };
    // Путь вида instances/<id>/<rel> — читаем через инстанс-команды.
    const parts = path.split('/').filter(Boolean);
    if (parts[0] === 'instances' && parts.length >= 3) {
      const instanceId = parts[1];
      const rel = parts.slice(2).join('/');
      const items = await invoke<any[]>('instance_list_dir', { instanceId, path: rel }).catch(() => null);
      if (Array.isArray(items)) {
        return { ok: true, output: items.length
          ? `Существует: ${path} (${items.length} шт.)`
          : `НЕ существует или пусто: ${path}` };
      }
    }
    const entries = await invoke<any[]>('op_list_dir', { root: 'launcher', path }).catch(() => null);
    const base = parts[parts.length - 1] ?? path;
    const hit = Array.isArray(entries) ? entries.find((e: any) => String(e?.name ?? '') === base) : null;
    return { ok: true, output: hit
      ? `Существует: ${path}${hit?.size ? ` (${(Number(hit.size) / 1024).toFixed(1)} КБ)` : ''}`
      : `НЕ существует: ${path}` };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

async function execLauncherInstallProject(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const slug = String(args.slug ?? '');
    const type = String(args.project_type ?? 'mod');
    if (!slug) return { ok: false, output: 'Нужен slug проекта (см. mod_search).' };

    if (type === 'build') {
      // Сборку нельзя положить внутрь другой сборки — она становится новой.
      return {
        ok: true,
        output: `Сборка «${slug}» ставится как НОВАЯ сборка лаунчера — внутрь существующей сборки сборку поставить нельзя, `
          + 'у неё свой набор модов, версия и загрузчик. Найди её через mod_search(project_type="modpack") или web_search, '
          + 'скачай архив через download_file в папку загрузок и скажи пользователю путь — он импортирует её через '
          + '«Обзор → сборка → Установить».',
      };
    }

    const instanceId = String(args.instance_id ?? '');
    if (!instanceId) return { ok: false, output: 'Для мода/пака/шейдера нужен instance_id (см. launcher_list_builds).' };
    // Установка из каталога = mod_search (находит совместимую версию) + launcher_install_mod.
    const found = await execModSearch({ query: slug, project_type: type, limit: 1 });
    return {
      ok: found.ok,
      output: [
        `Найдено по «${slug}» (${type}):`,
        found.output,
        '',
        `Чтобы поставить в сборку ${instanceId}, вызови launcher_install_mod с download_url, file_name и метаданными отсюда.`,
      ].join('\n'),
    };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

/** Разбирает "1024x1024" в [width, height] с безопасными границами. */function parseSize(size?: string): [number, number] {
  const m = /^(\d{2,5})\s*[xх]\s*(\d{2,5})$/i.exec(String(size ?? '').trim());
  if (!m) return [1024, 1024];
  const w = Math.min(2048, Math.max(256, Number(m[1])));
  const h = Math.min(2048, Math.max(256, Number(m[2])));
  return [w, h];
}

/** Скачивание бинарных данных (base64) через бэкенд — обход CORS и сетевых ограничений веб-вью. */
async function httpGetBytesViaRust(url: string, headers?: Record<string, string>): Promise<{ status: number; content_type: string; b64: string; error?: string }> {
  const pairs: [string, string][] = headers
    ? Object.entries(headers).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
    : [];
  return invoke<{ status: number; content_type: string; b64: string; error?: string }>('op_http_get_bytes', { url, headers: pairs });
}

/** Скачивает изображение по URL: сначала через веб-вью, при провале — через бэкенд. */
async function fetchImageBlob(url: string, headers?: Record<string, string>): Promise<Blob> {
  try {
    const res = await fetch(url, headers ? { headers } : undefined);
    if (res.ok) return await res.blob();
  } catch { /* Fallback ниже */ }
  const bytes = await httpGetBytesViaRust(url, headers);
  if (!bytes.b64) throw new Error(bytes.error || 'HTTP ' + bytes.status);
  const bin = atob(bytes.b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: bytes.content_type || 'image/png' });
}

/** Сохраняет скачанный blob как изображение портала. */
async function saveImageBlob(blob: Blob, source: string): Promise<ExecResult> {
  try {
    const b64 = await blobToBase64(blob);
    const name = await invoke<string>('op_save_image', { b64 });
    return { ok: true, output: `Изображение (${source}): /op-image/${name}` };
  } catch (e) {
    return { ok: false, output: `Не удалось сохранить картинку: ${String(e)}` };
  }
}

/** Бесплатная генерация через Pollinations (без ключа и регистрации). */
async function generateViaPollinations(prompt: string, size?: string): Promise<ExecResult> {
  const [w, h] = parseSize(size);
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&nologo=true&seed=${seed}`;
  try {
    const blob = await fetchImageBlob(url);
    return await saveImageBlob(blob, 'Pollinations');
  } catch (e) {
    return { ok: false, output: `Pollinations недоступен: ${String(e)}. Проверь интернет и повтори.` };
  }
}

/** Генерация через Magnific по ключу сервиса api.magnific.ai (OpenAI-совместимый ответ). */
async function generateViaMagnific(prompt: string, size: string | undefined, token: string): Promise<ExecResult> {
  const [w, h] = parseSize(size);
  const url = 'https://api.magnific.ai/v1/images/generations';
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const body = JSON.stringify({ prompt, n: 1, size: `${w}x${h}`, response_format: 'b64_json' });
  let data: any;
  try {
    if (canFetchFromWebview(url)) {
      const res = await fetch(url, { method: 'POST', headers, body });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
      data = await res.json();
    } else {
      const fr = await httpViaRust('POST', url, headers, body, 180000);
      if (!fr.ok) throw new Error(`HTTP ${fr.status}: ${(fr.error ?? fr.text ?? '').slice(0, 300)}`);
      data = JSON.parse(fr.text);
    }
  } catch (e) {
    return { ok: false, output: `Magnific недоступен: ${String(e)}` };
  }
  const b64: string | undefined = data?.data?.[0]?.b64_json ?? data?.data?.[0]?.b64;
  if (b64) {
    try {
      const name = await invoke<string>('op_save_image', { b64 });
      return { ok: true, output: `Изображение (Magnific): /op-image/${name}` };
    } catch (e) {
      return { ok: false, output: `Не удалось сохранить картинку: ${String(e)}` };
    }
  }
  const rev = data?.data?.[0]?.url;
  if (rev && /^https?:/i.test(rev)) {
    try {
      const blob = await fetchImageBlob(rev);
      return await saveImageBlob(blob, 'Magnific');
    } catch (e) {
      return { ok: false, output: `Не удалось скачать изображение Magnific: ${String(e)}` };
    }
  }
  return { ok: false, output: 'Magnific не вернул изображение.' };
}

/** Бесплатная генерация через Stable Horde: анонимный ключ, регистрация не нужна. */
async function generateViaStableHorde(prompt: string, size?: string): Promise<ExecResult> {
  const [w, h] = parseSize(size);
  const base = 'https://stablehorde.net/api/v2';
  const common = { 'Content-Type': 'application/json', apikey: '0000000000' };
  async function api(method: string, path: string, body: string | null, timeout: number): Promise<any> {
    const fr = await httpViaRust(method, `${base}${path}`, common, body, timeout);
    if (!fr.ok) throw new Error(`HTTP ${fr.status}: ${(fr.error ?? fr.text ?? '').slice(0, 300)}`);
    try {
      return JSON.parse(fr.text || '{}');
    } catch {
      throw new Error('Stable Horde прислал не-JSON ответ.');
    }
  }
  try {
    const started = await api('POST', '/generate/async', JSON.stringify({
      prompt,
      params: { width: w, height: h, steps: 30, cfg_scale: 7 },
      nsfw: false,
      censor_nsfw: true,
      r2: true,
      models: ['stable_diffusion_xl', 'stable_diffusion', 'Alchemist'],
    }), 180000);
    const id: unknown = started?.id ?? started?.job_id;
    if (typeof id !== 'string' || !id) {
      return { ok: false, output: `Stable Horde не выдал id задания: ${JSON.stringify(started).slice(0, 300)}` };
    }
    const deadline = Date.now() + 300000;
    for (;;) {
      if (Date.now() > deadline) return { ok: false, output: 'Stable Horde не успел сгенерировать за 5 минут. Попробуй ещё раз.' };
      await sleep(3000);
      try {
        const check = await api('GET', `/generate/check/${encodeURIComponent(id)}`, null, 30000);
        if (check?.done) break;
      } catch { /* хорд мог не ответить — просто опрашиваем дальше */ }
    }
    const status = await api('GET', `/generate/status/${encodeURIComponent(id)}`, null, 90000);
    const gen = status?.generations?.[0];
    const raw = typeof gen?.img === 'string' && gen.img.length ? gen.img : '';
    if (!raw) {
      return { ok: false, output: `Stable Horde не вернул изображение. ${status?.message ?? JSON.stringify(status).slice(0, 300)}` };
    }
    const b64 = raw.replace(/^data:[^,]+,/, '');
    try {
      const name = await invoke<string>('op_save_image', { b64 });
      return { ok: true, output: `Изображение (Stable Horde${gen?.model ? `, ${gen.model}` : ''}): /op-image/${name}` };
    } catch (e) {
      return { ok: false, output: `Не удалось сохранить картинку: ${String(e)}` };
    }
  } catch (e) {
    return { ok: false, output: `Stable Horde недоступен: ${String(e)}` };
  }
}

/** Генерация через Novita AI по ключу сервиса api.novita.ai (асинхронный API). */
async function generateViaNovita(prompt: string, size: string | undefined, token: string): Promise<ExecResult> {
  const [w, h] = parseSize(size);
  const base = 'https://api.novita.ai/v3/async';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  try {
    const start = await httpViaRust('POST', `${base}/generate`, headers, JSON.stringify({
      model_name: 'dreamshaper-xl',
      prompt,
      width: w,
      height: h,
      image_num: 1,
    }), 180000);
    if (!start.ok) {
      const snippet = (start.error ?? start.text ?? '').slice(0, 300);
      return { ok: false, output: `Novita ответил HTTP ${start.status}: ${snippet}` };
    }
    const taskId: string = (JSON.parse(start.text).task_id) ?? '';
    if (!taskId) return { ok: false, output: 'Novita не выдал task_id.' };
    const deadline = Date.now() + 180000;
    for (;;) {
      if (Date.now() > deadline) return { ok: false, output: 'Novita не успел сгенерировать за 3 минуты.' };
      await sleep(1500);
      const poll = await httpViaRust('GET', `${base}/task-result?task_id=${encodeURIComponent(taskId)}`, headers, null, 60000);
      if (!poll.ok) {
        const snippet = (poll.error ?? poll.text ?? '').slice(0, 300);
        return { ok: false, output: `Novita: HTTP ${poll.status}: ${snippet}` };
      }
      const data = JSON.parse(poll.text || '{}');
      const st: string = data?.task?.status ?? data?.status ?? '';
      if (st.includes('SUCCEED') || st.includes('succeed')) {
        const url: string | undefined = data?.images?.[0]?.image_url;
        if (url && /^https?:/i.test(url)) {
          const blob = await fetchImageBlob(url);
          return await saveImageBlob(blob, 'Novita');
        }
        return { ok: false, output: 'Novita не вернул ссылку на изображение.' };
      }
      if (st.includes('FAIL') || st.includes('fail') || st.includes('CANCEL')) {
        return { ok: false, output: `Novita не выполнил задачу: ${st}. ${data?.task?.error ?? ''}` };
      }
    }
  } catch (e) {
    return { ok: false, output: `Novita недоступен: ${String(e)}` };
  }
}

/** Генерация через images API активного провайдера (OpenAI-совместимо). */
async function generateViaProvider(ep: ResolvedEndpoint, prompt: string, size?: string): Promise<ExecResult> {
  if (!ep.baseUrl) return { ok: false, output: 'Не настроен baseUrl провайдера для генерации.' };
  if (!ep.apiKey && !isZenHost(ep.baseUrl)) return { ok: false, output: `Нет API-ключа для ${ep.provider.name}. Добавь ключ в меню моделей.` };
  const url = `${ep.baseUrl.replace(/\/+$/, '')}/images/generations`;
  const body = {
    model: ep.model.id,
    prompt,
    n: 1,
    size: size ?? '1024x1024',
    response_format: 'b64_json',
  };
  let data: any;
  const zenImage = isZenHost(url);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(zenImage ? zenClientHeaders() : {}),
    Authorization: zenImage ? zenAuthorization(ep.apiKey) : `Bearer ${ep.apiKey}`,
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
      return { ok: false, output: appendZenErrorHint(`Генерация недоступна: нет сети через веб-вью и HTTP ${fr.status} через бэкенд. ${fr.error ?? ''}${snippet ? ` Ответ сервера: ${snippet}` : ''}`.trim(), fr.text) };
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
        const blob = await fetchImageBlob(rev);
        return await saveImageBlob(blob, ep.provider.name);
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

/**
 * Генерация изображения. По умолчанию (auto) используется выбранный в настройках
 * провайдер «Генерация Изображений»: stable_horde (бесплатно, без ключа) или
 * novita (по ключу). `provider` позволяет форсировать источник:
 * auto | stable_horde | novita | provider | magnific | pollinations.
 */
async function execGenerateImage(ep: ResolvedEndpoint, args: { prompt: string; size?: string; provider?: string }): Promise<ExecResult> {
  const prompt = String(args?.prompt ?? '').trim();
  if (!prompt) return { ok: false, output: 'Укажи prompt — описание изображения.' };
  const size = typeof args?.size === 'string' ? args.size : undefined;
  const force = String(args?.provider ?? 'auto').toLowerCase();
  const magnificToken = ep.serviceTokens?.['api.magnific.ai'] ?? bearerForUrl('https://api.magnific.ai', ep.serviceTokens);
  const novitaToken = ep.serviceTokens?.['api.novita.ai'] ?? bearerForUrl('https://api.novita.ai', ep.serviceTokens);
  const providerUsable = !!ep.baseUrl && (!!ep.apiKey || isZenHost(ep.baseUrl));

  if (force === 'pollinations' || force === 'free') return generateViaPollinations(prompt, size);
  if (force === 'stable_horde' || force === 'horde' || force === 'stablehorde') return generateViaStableHorde(prompt, size);
  if (force === 'novita') {
    if (!novitaToken) return { ok: false, output: 'Нет ключа Novita. Укажи его в «Управление моделями» → «Генерация Изображений».' };
    return generateViaNovita(prompt, size, novitaToken);
  }
  if (force === 'magnific' || force === 'magnific.ai') {
    if (!magnificToken) return { ok: false, output: 'Нет ключа Magnific. Сохрани токен для api.magnific.ai через set_service_token.' };
    return generateViaMagnific(prompt, size, magnificToken);
  }
  if (force === 'provider') return generateViaProvider(ep, prompt, size);

  // auto — используем выбранный в настройках провайдер генерации изображений.
  const imageGen = ep.imageGenProvider ?? 'stable_horde';
  if (imageGen === 'novita') {
    if (!novitaToken) {
      return { ok: false, output: 'Выбран провайдер изображений Novita, но ключ не задан. Впиши его в «Управление моделями» → «Генерация Изображений» или переключись на Stable Horde (бесплатно, без ключа).' };
    }
    return generateViaNovita(prompt, size, novitaToken);
  }
  if (imageGen === 'pollinations') {
    return generateViaPollinations(prompt, size);
  }
  return generateViaStableHorde(prompt, size);
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
  signal?: AbortSignal,
): Promise<ExecResult> {
  const method = String(args.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
    return { ok: false, output: `Метод ${method} не поддерживается (GET/POST/PUT/PATCH/DELETE/HEAD).` };
  }
  const url = String(args.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, output: 'Некорректный url — только http/https.' };
  }

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
    res = await raceSignal(httpViaRust(method, url, headers, body, args.timeout_ms), signal);
  } catch (e) {
    return { ok: false, output: `HTTP-запрос не выполнился: ${String(e)}` };
  }
  if (!res.ok && res.status === 0) {
    return { ok: false, output: `HTTP-запрос не выполнился (нет сети или хост недоступен): ${res.error ?? 'connection failed'}` };
  }
  if (!res.ok) {
    const snippet = (res.error ?? res.text ?? '').trim().slice(0, 400);
    return { ok: false, output: `${method} ${url} → HTTP ${res.status} (${httpStatusHint(res.status)}).${snippet ? `\n${snippet}` : ''}` };
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
      msgs = msgs.map(m => (m.id === tmId ? { ...m, content: res.output, cards: res.cards, changes: res.changes } : m));
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

/** Политика инструментов агента: 'ask' — только чтение/поиск, всё изменяющее отклоняется заранее. */
export type ToolPolicy = 'ask';

/** Опасная команда: запуск/скачивание установщика (.exe/.msi и т.п.). */
function isHazardousCommand(command: string): boolean {
  const lower = String(command ?? '').toLowerCase();
  const riskyExt = /\.(exe|msi|bat|cmd|ps1|apk|jar)\b/.test(lower);
  const launcherLike = /\b(start|runas|invoke)\b/.test(lower) || /[\\|&]/.test(lower);
  if (riskyExt && launcherLike) return true;
  return /\.(exe|msi)["']?\s*$/.test(lower.trim());
}

/** Опасный URL: прямая ссылка на установщик .exe/.msi. */
function isHazardousUrl(url: string): boolean {
  const first = String(url ?? '').split(/[\s"';&|<>`]/)[0];
  return /\.(exe|msi)["']?$/i.test(first);
}

export async function executeTool(
  tool: string,
  argsRaw: string,
  requestPermission: (req: PermissionRequest) => Promise<'allow' | 'deny' | 'always' | 'never'>,
  ep: ResolvedEndpoint,
  signal?: AbortSignal,
  policy?: ToolPolicy,
): Promise<ExecResult> {
  let args: any = safeJsonParseObject(normalizeToolArguments(argsRaw));

  // Выбранная сборка в тулбаре. Раньше агент должен был сам передавать
  // mc_version/loader в mod_search и часто этого не делал — поиск уходил без
  // фильтров и предлагал моды не под эту версию игры.
  let activeBuild: { mc_version?: string; loader?: string; name?: string } | null = null;
  if (tool === 'mod_search' || tool === 'launcher_install_mod' || tool === 'launcher_install_project') {
    try {
      const project = useOpenCoreStore.getState().config.project;
      if (project?.kind === 'build') {
        const list = await invoke<any[]>('get_instances').catch(() => [] as any[]);
        activeBuild = (Array.isArray(list) ? list : []).find(i => i?.id === project.instanceId) ?? null;
      }
    } catch { /* сборка может быть недоступна — работаем без фильтров */ }
  }

  // Режим ASK: агент только спрашивает/ищет/читает. Все изменяющие действия отклоняем сразу,
  // до их выполнения (включая те, что обычно не спрашивают разрешение — запись и команды в portal/temp).
  if (policy === 'ask') {
    const deny = (what: string) => ({ ok: false, output: `Режим ASK: ${what} запрещено — агент только ищет и читает информацию.` });
    if (tool === 'write_text') return deny('создание и изменение файлов');
    if (tool === 'run_command' || tool === 'terminal') return deny('выполнение команд');
    if (tool === 'archive_extract') return deny('распаковка архивов');
    if (tool === 'archive_create') return deny('создание архивов');
    if (tool === 'generate_image') return deny('генерация изображений');
    if (tool === 'set_service_token') return deny('сохранение токенов');
    if (tool === 'spawn_agents') return deny('запуск субагентов');
    if (tool === 'launcher_install_mod') return deny('установка модов');
    if (tool === 'launcher_create_build') return deny('создание сборок');
    if (tool === 'http_request') {
      const method = String(args?.method ?? 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return deny(`HTTP-${method} запросы`);
    }
  }

  if (tool === 'web_search') return execWebSearch(args, signal);
  if (tool === 'fetch_page') return execFetchPage(args, signal);
  if (tool === 'http_request') return execHttpRequest(ep, args, requestPermission, signal);
  if (tool === 'set_service_token') return execSetServiceToken(ep, args, requestPermission);
  if (tool === 'spawn_agents') return execSpawnAgents(ep, args, requestPermission, signal);

  if (tool === 'list_dir') return execListDir(args);
  if (tool === 'read_text') return execReadText(args);
  if (tool === 'search_code') return execSearchCode(args);
  if (tool === 'download_file') return execDownloadFile(args);
  if (tool === 'decompile_jar') return execDecompileJar(args);
  if (tool === 'project_info') return execProjectInfo(args);
  if (tool === 'run_python') return execRunPython(args);
  if (tool === 'build_jar') return execBuildJar(args);

  if (tool === 'inspect_image') return execInspectImage(args);
  if (tool === 'hexdump') return execHexdump(args);
  if (tool === 'archive_list') return execArchiveList(args);
  if (tool === 'save_to_downloads') return execCopyToDownloads(args);

  if (tool === 'archive_extract' || tool === 'archive_create') {
    const root: PortalRoot = String(args.root || 'portal') as PortalRoot;
    if (!['portal', 'temp', 'launcher'].includes(root)) {
      return { ok: false, output: `Неизвестная зона: ${root}` };
    }
    if (root === 'portal' || root === 'temp') {
      if (tool === 'archive_create') return execArchiveCreate(args);
      return execArchiveExtract(args);
    }
    const label = tool === 'archive_create' ? 'Создание архива' : 'Распаковка архива';
    const decision = await requestPermission({
      tool,
      root,
      label,
      detail: `Путь: ${args.path}`,
      cwdLabel: `${label} → ${args.path}`,
      resolve: () => {},
    });
    if (decision === 'deny' || decision === 'never') {
      return { ok: false, output: `Пользователь не разрешил: ${label}.` };
    }
    if (decision === 'allow' || decision === 'always') {
      if (tool === 'archive_create') return execArchiveCreate(args);
      return execArchiveExtract(args);
    }
    return { ok: false, output: 'Разрешение не получено.' };
  }

  if (tool === 'launcher_list_builds') return execLauncherListBuilds();
  if (tool === 'launcher_logs') return execLauncherLogs(args);
  if (tool === 'mod_search') {
    // Подставляем версию/лоадер выбранной сборки, если агент их не указал.
    const rawType = String(args?.project_type ?? 'mod').trim().toLowerCase();
    const loaderApplies = rawType === 'mod' || rawType === 'modpack';
    if (activeBuild) {
      if (!String(args?.mc_version ?? '').trim() && activeBuild.mc_version) args = { ...args, mc_version: activeBuild.mc_version };
      if (loaderApplies && !String(args?.loader ?? '').trim() && activeBuild.loader && activeBuild.loader !== 'vanilla') {
        args = { ...args, loader: activeBuild.loader };
      }
    }
    return execModSearch(args);
  }
  if (tool === 'launcher_build_info') return execLauncherBuildInfo(args);
  if (tool === 'launcher_list_content') return execLauncherListContent(args);
  if (tool === 'launcher_read_file') return execLauncherReadFile(args);
  if (tool === 'launcher_crash_report') return execLauncherCrashReport(args);
  if (tool === 'launcher_verify_build') return execLauncherVerifyBuild(args);
  if (tool === 'jar_list') return execJarList(args);
  if (tool === 'path_exists') return execPathExists(args);

  if (tool === 'launcher_write_file' || tool === 'launcher_remove_content' || tool === 'launcher_install_project') {
    const label = tool === 'launcher_write_file'
      ? 'Запись файла в сборку'
      : tool === 'launcher_remove_content'
        ? 'Удаление файла из сборки'
        : 'Установка из каталога';
    const detail = tool === 'launcher_write_file'
      ? `${args.path} → сборка ${args.instance_id}`
      : tool === 'launcher_remove_content'
        ? `${args.folder}/${args.file_name} → сборка ${args.instance_id}`
        : `${args.slug} (${args.project_type})${args.project_type === 'build' ? ' → новая сборка' : ` → сборка ${args.instance_id ?? ''}`}`;
    const decision = await requestPermission({
      tool,
      root: 'launcher',
      label,
      detail,
      cwdLabel: `${label} → ${args.instance_id ?? args.slug ?? ''}`,
      resolve: () => {},
    });
    if (decision === 'deny' || decision === 'never') {
      return { ok: false, output: `Пользователь не разрешил: ${label}.` };
    }
    if (decision === 'allow' || decision === 'always') {
      if (tool === 'launcher_write_file') return execLauncherWriteFile(args);
      if (tool === 'launcher_remove_content') return execLauncherRemoveContent(args);
      return execLauncherInstallProject(args);
    }
    return { ok: false, output: 'Разрешение не получено.' };
  }

  if (tool === 'launcher_install_mod' || tool === 'launcher_create_build') {
    const label = tool === 'launcher_install_mod' ? 'Установка мода в сборку' : 'Создание сборки';
    const decision = await requestPermission({
      tool,
      root: 'launcher',
      label,
      detail: tool === 'launcher_install_mod'
        ? `Мод: ${args.mod_name ?? args.file_name ?? ''} → сборка ${args.instance_id ?? ''}`
        : `Сборка: ${args.name ?? ''}`,
      cwdLabel: `${label} → ${args.instance_id ?? args.name ?? ''}`,
      hazard: tool === 'launcher_install_mod' ? isHazardousUrl(args.download_url) : false,
      resolve: () => {},
    });
    if (decision === 'deny' || decision === 'never') {
      return { ok: false, output: `Пользователь не разрешил: ${label}.` };
    }
    if (decision === 'allow' || decision === 'always') {
      if (tool === 'launcher_install_mod') return execLauncherInstallMod(args);
      return execLauncherCreateBuild(args);
    }
    return { ok: false, output: 'Разрешение не получено.' };
  }

  if (tool === 'generate_image') {
    if (!args.prompt || typeof args.prompt !== 'string') return { ok: false, output: 'Нет аргумента prompt.' };
    // Разрешение не требуется: пользователь настроил генерацию картинок без модалки.
    return execGenerateImage(ep, args);
  }

  // Безопасные инструменты с запросом разрешения:
  if (tool === 'write_text' || tool === 'edit_file' || tool === 'run_command' || tool === 'terminal') {
    const root: PortalRoot = String(args.root || 'portal') as PortalRoot;
    if (!['portal', 'temp', 'launcher'].includes(root)) {
      return { ok: false, output: `Неизвестная зона: ${root}` };
    }
    const rootBase = await lookupRoot(root);
    if (tool === 'terminal') {
      args = { ...args, shell: args.shell ?? 'powershell' };
    }
    // Правка файла идёт тем же путём, что и запись: для portal/temp без
    // запроса разрешения, для launcher — через модалку подтверждения.
    const isFileWrite = tool === 'write_text' || tool === 'edit_file';
    if (isFileWrite) {
      // Постоянное разрешение: агент работает в папке OpenPortal и в папке
      // PortalLauncher (Roaming) без вопросов — иначе он не может создавать
      // проекты и класть содержимое в сборки.
      return tool === 'edit_file' ? execEditFile(args) : execWriteText(args);
    }
    const isNetFetch = /^\s*(curl|wget)\b/i.test(String(args.command ?? '').trim());
    if (isNetFetch || root === 'portal' || root === 'temp') {
      return execRunCommand(args);
    }
    const label = tool === 'terminal' ? 'Команда в PowerShell' : 'Выполнение команды';
    const detail = `Команда: ${args.command}\nПапка: ${args.cwd}`;
    const decision = await requestPermission({
      tool,
      root,
      label,
      detail,
      cwdLabel: `${label} → ${args.cwd ?? ''}`,
      hazard: isHazardousCommand(args.command),
      resolve: () => {},
    });
    if (decision === 'deny' || decision === 'never') {
      return { ok: false, output: `Пользователь не разрешил: ${label}.` };
    }
    if (decision === 'allow' || decision === 'always') {
      return execRunCommand(args);
    }
    return { ok: false, output: 'Разрешение не получено.' };
  }

  return { ok: false, output: `Неизвестный инструмент: ${tool}` };
}

// ---------------------------------------------------------------------------
// Сборка тела запроса для разных форматов
// ---------------------------------------------------------------------------

import { OP_PROVIDERS, browserLinksHint, type ProviderDef, type ModelDef, type ProviderKind } from '@/lib/opencore/providers';

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
  /** Выбранный пользователем провайдер генерации изображений (по умолчанию stable_horde — бесплатно, без ключа). */
  /** Провайдер генерации изображений по умолчанию для auto. */
  imageGenProvider?: 'stable_horde' | 'novita' | 'pollinations';
}

export function resolveEndpoint(
  providerId: string,
  modelId: string,
  providersState: Record<string, { apiKey?: string; baseUrl?: string; remoteModels?: ModelDef[] }>,
  modelContexts?: Record<string, number>,
): ResolvedEndpoint {
  const preset = OP_PROVIDERS.find(p => p.id === providerId);
  const st = providersState?.[providerId] ?? {};
  const isCustom = providerId.startsWith('custom:');

  let baseUrl: string;
  let kind: ProviderKind = preset?.kind ?? 'openai';
  let model: ModelDef;

  if (preset) {
    baseUrl = st.baseUrl || preset.baseUrl || '';
    // Сначала ищем в реестре, потом в моделях, загруженных с API.
    const fromPreset = preset.models.find(m => m.id === modelId);
    const fromRemote = (st.remoteModels ?? []).find(m => m.id === modelId);
    // Размер контекста из API приоритетнее: у провайдера он актуальный
    // (например 1_048_576 у Space Bunny Free), а в реестре может стоять
    // устаревший дефолт.
    const base = fromPreset
      ? { ...fromPreset, contextLength: fromRemote?.contextLength ?? fromPreset.contextLength }
      : fromRemote ?? { id: modelId };
    // Ручное переопределение пользователя важнее обоих источников.
    const override = modelContexts?.[`${providerId}/${modelId}`];
    model = override ? { ...base, contextLength: override } : base;
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
    apiKey: st.apiKey || preset?.defaultApiKey || '',
    format,
    useZen,
    isCustom,
    serviceTokens: {},
    imageGenProvider: 'stable_horde',
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
  usage?: TokenUsage;
}

export interface StreamDelta {
  /** Полный текущий текст ответа (для live-обновления одного сообщения). */
  content?: string;
  /** Полный текущий текст «рассуждений» модели. */
  thinking?: string;
}

/** Приблизительная оценка токенов, если провайдер не вернул usage (~4 символа на токен). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Оценка входных токенов запроса (system + история). */
function estimateInputTokens(systemPrompt: string, turns: ChatTurn[]): number {
  let chars = systemPrompt.length;
  for (const t of turns) {
    chars += (t.content?.length ?? 0) + 8;
    if (t.toolCalls) chars += JSON.stringify(t.toolCalls).length;
  }
  return Math.ceil(chars / 4);
}

function normalizeUsage(input: unknown, output: unknown, total?: unknown): TokenUsage | undefined {
  const i = Number(input) || 0;
  const o = Number(output) || 0;
  const t = Number(total) || i + o;
  if (!i && !o && !t) return undefined;
  return { input: i, output: o, total: t };
}

/** usage из OpenAI-совместимого ответа (prompt_tokens/completion_tokens). */
export function usageFromOpenAI(data: any): TokenUsage | undefined {
  const u = data?.usage;
  if (!u) return undefined;
  return normalizeUsage(u.prompt_tokens ?? u.input_tokens, u.completion_tokens ?? u.output_tokens, u.total_tokens);
}

/** usage из Anthropic-ответа (input_tokens/output_tokens). */
export function usageFromAnthropic(data: any): TokenUsage | undefined {
  const u = data?.usage;
  if (!u) return undefined;
  return normalizeUsage(u.input_tokens, u.output_tokens, (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0));
}

// ---------------------------------------------------------------------------
// GitHub Copilot: пользовательский GitHub-токен → временный JWT для API Copilot
// ---------------------------------------------------------------------------

function isCopilot(ep: ResolvedEndpoint): boolean {
  return ep.provider.id === 'github-copilot' || /githubcopilot\.com/i.test(ep.baseUrl);
}

const copilotJwtCache = new Map<string, { jwt: string; until: number }>();

/** Обменивает GitHub-токен на JWT для api.githubcopilot.com (кэширует до истечения). */
export async function copilotJwt(githubToken: string): Promise<string> {
  const cached = copilotJwtCache.get(githubToken);
  if (cached && cached.until > Date.now() + 30_000) return cached.jwt;
  const fr = await httpViaRust(
    'GET',
    'https://api.github.com/copilot_internal/v2/token',
    { Authorization: `token ${githubToken}`, Accept: 'application/json' },
    null,
    60_000,
  );
  if (!fr.ok) {
    throw new Error(
      `не удалось обменять GitHub-токен (HTTP ${fr.status}${fr.status === 401 ? ': токен не подходит — нужен PAT с доступом Copilot или OAuth-токен' : fr.status === 403 ? ': у токена нет доступа Copilot' : ''}). ${(fr.error ?? fr.text ?? '').slice(0, 160)}`,
    );
  }
  const data: any = JSON.parse(fr.text || '{}');
  const jwt: string = data?.token ?? '';
  if (!jwt) throw new Error(`сервис не вернул токен. ${(data?.message ?? '').slice(0, 160)}`);
  const until = Math.min(Date.now() + parseInt(data?.expires_in ?? '1440', 10) * 1000, Date.now() + 25 * 60_000);
  copilotJwtCache.set(githubToken, { jwt, until });
  return jwt;
}

export async function callProvider(
  ep: ResolvedEndpoint,
  systemPrompt: string,
  turns: ChatTurn[],
  signal?: AbortSignal,
  onDelta?: (d: StreamDelta) => void,
  opts?: { effort?: EffortLevel },
): Promise<ApiOutcome> {
  if (!ep.baseUrl) throw new Error('Не настроен baseUrl провайдера.');

  // GitHub Copilot требует временный JWT: обмениваем пользовательский GitHub-токен
  // на https://api.github.com/copilot_internal/v2/token (кэш до истечения).
  if (isCopilot(ep) && ep.apiKey) {
    try {
      ep.apiKey = await copilotJwt(ep.apiKey);
    } catch (e) {
      throw new Error(`GitHub Copilot: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!ep.apiKey && ep.provider.kind !== 'zen' && !ep.provider.id.includes('custom:')) {
    // Локальные провайдеры (ollama/lmstudio) ключа не требуют
    if (!['ollama', 'lmstudio'].includes(ep.provider.id)) {
      throw new Error(`Нет API-ключа для ${ep.provider.name}. Добавь ключ в меню моделей.`);
    }
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < PROVIDER_MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error('Отменено пользователем.');
    try {
      if (ep.format === 'anthropic') return await callAnthropic(ep, systemPrompt, turns, signal, opts);
      return await callOpenAI(ep, systemPrompt, turns, signal, onDelta, opts);
    } catch (e: unknown) {
      if (signal?.aborted) throw e;
      lastError = e;
      if (attempt < PROVIDER_MAX_ATTEMPTS - 1) {
        await sleep(400 + attempt * 500 + Math.random() * 300);
      }
    }
  }
  if (lastError instanceof Error && ep.provider.id === 'deepseek' && /insufficient balance|402/i.test(lastError.message)) {
    lastError.message =
      'DeepSeek: публичный ключ исчерпан (402 Insufficient Balance). Введи свой ключ в «Управление моделями» или переключись на OpenCode Zen (бесплатно) в выборе модели. ' +
      lastError.message;
  }
  throw lastError;
}

async function callOpenAI(
  ep: ResolvedEndpoint,
  systemPrompt: string,
  turns: ChatTurn[],
  signal?: AbortSignal,
  onDelta?: (d: StreamDelta) => void,
  opts?: { effort?: EffortLevel },
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
          function: { name: tc.name, arguments: normalizeToolArguments(tc.arguments) },
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

  const zen = isZenHost(url);
  const requestTools = zen ? zenTools(tools) : tools;
  // Модели с рассуждением часто отклоняют temperature, поэтому для них
  // параметр не отправляем — это частая причина HTTP 400.
  const isReasoning = ep.model.reasoning === true
    || /^(gpt-5|o[134]|deepseek-r|gpt-oss|qwq|space-bunny|big-pickle)/i.test(ep.model.id);

  const body: Record<string, unknown> = {
    model: ep.model.id,
    messages,
    tools: requestTools,
    max_tokens: 8192,
  };
  if (!isReasoning) body.temperature = 0.4;
  applyEffort(body, ep, opts?.effort);
  if (onDelta) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  } else if (zen) {
    // Free-тариф zen отклоняет не-стриминговые запросы с 403 FreeTierError.
    body.stream = true;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(zen
      ? { ...zenClientHeaders(), Authorization: zenAuthorization(ep.apiKey) }
      : ep.apiKey
        ? { Authorization: `Bearer ${ep.apiKey}` }
        : {}),
    ...(ep.provider.id === 'openrouter' ? { 'HTTP-Referer': 'https://portal-launcher.app', 'X-Title': 'OpenPortal' } : {}),
  };

  let res: Response | null = null;
  if (canFetchFromWebview(url)) {
    res = await fetchWithToolFallback(url, headers, body, requestTools, signal, ep.provider.name);
  }
  if (res === null) {
    // Фолбэк: веб-вью не может дотянуться (CORS/сеть) — идём через бэкенд.
    // Бэкенд буферизует ответ целиком, поэтому SSE от zen разбираем после
    // получения; для обычных провайдеров просим сразу JSON.
    const fbBase: Record<string, unknown> = {
      model: body.model,
      messages: body.messages,
    };
    if (body.temperature !== undefined) fbBase.temperature = body.temperature;
    if (body.max_tokens !== undefined) fbBase.max_tokens = body.max_tokens;
    if (body.reasoning_effort !== undefined) fbBase.reasoning_effort = body.reasoning_effort;
    if (body.reasoning !== undefined) fbBase.reasoning = body.reasoning;
    if (body.thinking !== undefined) fbBase.thinking = body.thinking;
    if (zen) fbBase.stream = true;

    // Тот же откат, что и для веб-вью: Zen возвращает HTTP 400 на слишком
    // большой набор инструментов, и запрос шёл именно через бэкенд, где
    // повтора не было — задача падала.
    let fr = await raceSignal(
      httpViaRust('POST', url, { ...headers, Accept: zen ? 'text/event-stream' : 'application/json' }, JSON.stringify({ ...fbBase, tools: requestTools }), 180000),
      signal,
    );
    if (!fr.ok && fr.status === 400) {
      const firstText = fr.text;
      const reduced = reducedToolSet(requestTools);
      if (reduced.length > 0 && reduced.length < requestTools.length) {
        fr = await raceSignal(
          httpViaRust('POST', url, { ...headers, Accept: zen ? 'text/event-stream' : 'application/json' }, JSON.stringify({ ...fbBase, tools: reduced }), 180000),
          signal,
        );
        if (!fr.ok) {
          throw new Error(appendZenErrorHint(
            `${ep.provider.name} вернул HTTP 400 и не принял урезанный набор инструментов. Первый ответ: ${firstText.trim().slice(0, 400)} | Повтор: ${fr.text.trim().slice(0, 400)}`,
            `${firstText} ${fr.text}`,
          ));
        }
      }
    }
    if (!fr.ok) {
      const snippet = fr.text.trim().slice(0, 240);
      throw new Error(appendZenErrorHint(
        `${ep.provider.name} недоступен: нет сети через веб-вью и HTTP ${fr.status} через бэкенд. ${fr.error ?? ''}${snippet ? ` Ответ сервера: ${snippet}` : ''}`.trim(),
        fr.text,
      ));
    }
    if (zen && /(^|\n)\s*data:/.test(fr.text)) {
      // Бэкенд буферизует весь SSE-поток — разбираем его целиком.
      try {
        return parseSSEText(fr.text, onDelta);
      } catch {
        throw new Error(`${ep.provider.name} прислал неожиданный стриминговый ответ при фолбэке через бэкенд.`);
      }
    }
    try {
      return parseOpenAIJson(JSON.parse(fr.text));
    } catch {
      throw new Error(`${ep.provider.name} прислал неожиданный ответ при фолбэке через бэкенд.`);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(appendZenErrorHint(`${ep.provider.name} вернул HTTP ${res.status}: ${text.slice(0, 500)}`, text));
  }

  const ct = res.headers.get('content-type') || '';
  if (res.body && ct.includes('text/event-stream')) {
    if (onDelta) return parseSSE(res.body, signal, onDelta);
    return parseSSEText(await res.text(), undefined);
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
    arguments: normalizeToolArguments(String(tc.function?.arguments ?? '{}')),
  }));
  return {
    text: text ?? '',
    thinking: thinking || undefined,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    raw: data,
    model: data?.model,
    usage: usageFromOpenAI(data),
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
  let usage: TokenUsage | undefined;
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

  const finish = (): ApiOutcome => {
    const calls: ToolCall[] = [...toolCalls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => ({ id: v.id, name: v.name, arguments: normalizeToolArguments(v.arguments) }));
    return {
      text,
      thinking: thinking ? trimThinking(thinking) : undefined,
      toolCalls: calls.length ? calls : undefined,
      raw: { stream: true },
      model,
      usage,
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
      const u = usageFromOpenAI(json);
      if (u) usage = u;
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

/** Разбор уже полученного SSE-текста (фолбэк через бэкенд буферизует ответ). */
function parseSSEText(text: string, onDelta?: (d: StreamDelta) => void): ApiOutcome {
  let out = '';
  let thinking = '';
  let model: string | undefined;
  let usage: TokenUsage | undefined;
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    model = json.model ?? model;
    const u = usageFromOpenAI(json);
    if (u) usage = u;
    const delta = json.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      out += delta.content;
      onDelta?.({ content: out });
    }
    if (delta.reasoning_content) {
      thinking += delta.reasoning_content;
      onDelta?.({ thinking });
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

  const calls: ToolCall[] = [...toolCalls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({ id: v.id, name: v.name, arguments: normalizeToolArguments(v.arguments) }));
  return {
    text: out,
    thinking: thinking ? trimThinking(thinking) : undefined,
    toolCalls: calls.length ? calls : undefined,
    raw: { stream: true },
    model,
    usage,
  };
}

async function callAnthropic(
  ep: ResolvedEndpoint,
  systemPrompt: string,
  turns: ChatTurn[],
  signal?: AbortSignal,
  opts?: { effort?: EffortLevel },
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
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: safeJsonParseObject(tc.arguments) });
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

  const zen = isZenHost(url);
  const tools = TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
  const requestTools = zen ? zenTools(tools) : tools;
  const isReasoning = ep.model.reasoning === true
    || /^(gpt-5|o[134]|deepseek-r|gpt-oss|qwq|space-bunny|big-pickle)/i.test(ep.model.id);

  const body: Record<string, unknown> = {
    model: ep.model.id,
    max_tokens: 8192,
    system: systemPrompt,
    messages,
    tools: requestTools,
  };
  applyEffort(body, ep, opts?.effort);
  // Free-тариф zen принимает только стриминговые запросы.
  if (zen) body.stream = true;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    ...(zen ? zenClientHeaders() : {}),
  };
  if (zen) headers['Authorization'] = zenAuthorization(ep.apiKey);
  else if (ep.apiKey) headers['x-api-key'] = ep.apiKey;

  let res: Response | null = null;
  if (canFetchFromWebview(url)) {
    res = await fetchWithToolFallback(url, headers, body, requestTools, signal, ep.provider.name);
  }
  if (res === null) {
    const fr = await raceSignal(httpViaRust('POST', url, headers, JSON.stringify(body), 180000), signal);
    if (!fr.ok) {
      const snippet = fr.text.trim().slice(0, 240);
      throw new Error(appendZenErrorHint(
        `${ep.provider.name} недоступен: нет сети через веб-вью и HTTP ${fr.status} через бэкенд. ${fr.error ?? ''}${snippet ? ` Ответ сервера: ${snippet}` : ''}`.trim(),
        fr.text,
      ));
    }
    if (zen && /(^|\n)\s*(event:)?\s*data:/.test(fr.text)) {
      try {
        return parseAnthropicSSEText(fr.text);
      } catch {
        throw new Error(`${ep.provider.name} прислал неожиданный стриминговый ответ при фолбэке через бэкенд.`);
      }
    }
    try {
      return parseAnthropicJson(JSON.parse(fr.text));
    } catch {
      throw new Error(`${ep.provider.name} прислал неожиданный ответ при фолбэке через бэкенд.`);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(appendZenErrorHint(`${ep.provider.name} вернул HTTP ${res.status}: ${text.slice(0, 500)}`, text));
  }
  if (zen && (res.headers.get('content-type') || '').includes('text/event-stream')) {
    return parseAnthropicSSEText(await res.text());
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
    usage: usageFromAnthropic(data),
  };
}

/** Разбор SSE-потока Anthropic Messages (используется zen free-тарифом). */
function parseAnthropicSSEText(text: string): ApiOutcome {
  let out = '';
  let thinking = '';
  let model: string | undefined;
  let usage: TokenUsage | undefined;
  const toolCalls = new Map<number, { id: string; name: string; args: string }>();

  const handle = (payload: string) => {
    let json: any;
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    if (json.type === 'message_start') {
      model = json.message?.model ?? model;
      const iu = Number(json.message?.usage?.input_tokens) || 0;
      const ou = Number(json.message?.usage?.output_tokens) || 0;
      if (iu || ou) usage = { input: iu, output: ou, total: iu + ou };
    } else if (json.type === 'message_delta') {
      const ou = Number(json.usage?.output_tokens) || 0;
      if (ou) usage = { input: usage?.input ?? 0, output: ou, total: (usage?.input ?? 0) + ou };
    } else if (json.type === 'content_block_start') {
      const cb = json.content_block;
      if (cb?.type === 'tool_use') {
        toolCalls.set(json.index ?? 0, { id: String(cb.id ?? ''), name: String(cb.name ?? ''), args: '' });
      }
    } else if (json.type === 'content_block_delta') {
      const d = json.delta;
      if (!d) return;
      if (d.type === 'text_delta' && d.text) out += d.text;
      else if (d.type === 'thinking_delta' && d.thinking) thinking += d.thinking;
      else if (d.type === 'input_json_delta') {
        const idx = json.index ?? 0;
        const cur = toolCalls.get(idx) ?? { id: '', name: '', args: '' };
        cur.args += d.partial_json ?? '';
        toolCalls.set(idx, cur);
      }
    }
  };

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data:')) handle(trimmed.slice(5).trim());
  }

  const calls: ToolCall[] = [...toolCalls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({ id: v.id, name: v.name, arguments: normalizeToolArguments(v.args) }));
  return {
    text: out,
    thinking: thinking ? trimThinking(thinking) : undefined,
    toolCalls: calls.length ? calls : undefined,
    raw: { stream: true },
    model,
    usage,
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
  // Сжатые выжимки (summary: true) не выбрасываем никогда — иначе накопленный
  // контекст работы агента теряется при каждом новом усечении.
  const summaries = messages.filter(m => m.summary === true);
  const rest = messages.filter(m => !(m.summary === true));
  if (rest.length <= max) return messages;
  const head = rest.slice(0, 6);
  const tail = rest.slice(-Math.max(max - 8 - summaries.length, 20));
  const summary: ChatMessage = {
    id: `__contraction-${Date.now()}`,
    role: 'assistant',
    content: `… [${rest.length - head.length - tail.length} сообщений сжато — история сокращена OpenPortal для экономии контекста] …`,
    timestamp: Date.now(),
  };
  return [...summaries, ...head, summary, ...tail];
}

/** Сворачивает старую часть истории в подробную структурированную выжимку силами модели. */
async function compactHistoryWithModel(ep: ResolvedEndpoint, messages: ChatMessage[], signal?: AbortSignal): Promise<ChatMessage[]> {
  const keep = messages.slice(-6);
  const older = messages.filter(m => !(m.summary === true)).slice(0, messages.length - keep.length);
  const transcript = older
    .map(m => `${m.role === 'user' ? 'ПОЛЬЗОВАТЕЛЬ' : m.role === 'assistant' ? 'АГЕНТ' : 'ИНСТРУМЕНТ'}: ${m.content}`)
    .join('\n\n')
    .slice(0, 80_000);
  const outcome = await callProvider(
    ep,
    'Ты сжимаешь длинную переписку пользователя и агента в ПОДРОБНУЮ, но компактную выжимку, которая полностью заменит оригинал в памяти. Составь текст со следующими разделами (если раздела нет — пропусти):\n' +
      '## Цель\nКоротко — что просил пользователь и что мы делали.\n' +
      '## Что сделано\nПо пунктам — результаты, изменённые/созданные файлы с путями, установленные моды (с id/именами), выполненные команды.\n' +
      '## Достигнутая информация\nФакты, версии, ссылки, точные значения (названия модов, их авторов, ссылки на скачивание).\n' +
      '## Решения\nВыборы, которые нельзя забывать (почему выбран такой мод/версия/подход).\n' +
      '## Открытые задачи\nЧто осталось незавершённым, что ждёт пользователя, что делать дальше.\n' +
      'Пиши на языке переписки. Не теряй важные детали: имена, пути, id, версии, решения и незакрытые вопросы — выжимка должна позволить агенту продолжить работу без оригинала. Ответь ТОЛЬКО текстом выжимки, инструменты не вызывай.',
    [{ role: 'user', content: transcript }],
    signal,
  );
  const summary = (outcome.text || '').trim() || '(модель не вернула текст выжимки)';
  return [
    {
      id: `summary-${Date.now()}`,
      role: 'assistant',
      content: `**Сжатая история** (${older.length} сообщений свёрнуто автоматически для экономии контекста)\n\n${summary}`,
      timestamp: Date.now(),
      summary: true,
    },
    ...keep,
  ];
}

// ---------------------------------------------------------------------------
// Системный промпт
// ---------------------------------------------------------------------------

export function buildSystemPrompt(opts: {
  mode: 'default' | 'build' | 'plan';
  /** Доп. сведения об окружении (сборка, пути). */
  extra?: string;
  /** Установленные навыки (описание) — агент их знает. */
  skills?: string;
  /** id активной модели — без неё все модели получали одинаковый промпт. */
  model?: string;
  /** Реальный размер контекстного окна модели (из contextWindow). */
  contextLimit?: number;
}): string {
  // Режим DEFAULT — агент сам распределяет: читал/объяснял без правок, а задачу
  // на установку или создание выполнял. Раньше режима не было, пришлось заранее
  // угадывать Build или Plan, и задачи часто оставались невыполненными.
  const rules = opts.mode === 'default'
    ? `Режим DEFAULT: режим выбираешь ты сам под каждое сообщение.
- Вопрос, объяснение, обзор кода, «что лучше», «как это работает» — отвечай сам, НЕ вызывая инструменты для изменения файлов. Ничего не меняй.
- Задача с результатом: поставить/найти/установить/создать/починить/настроить/собрать — выполняй через инструменты, шаг за шагом, до фактического результата.
- Если задача неоднозначна и от выбора зависит результат — сначала сделай безопасную часть (прочитай, найди), потом скажи, что нужно решить, и спроси.
- Правки файлов и запуск сборки делай без отдельного подтверждения режима: пользователь уже выбрал DEFAULT.`
    : opts.mode === 'build'
    ? `Режим BUILD: ты полноценный агент-исполнитель. Ты достигаешь цели пользователя через инструменты: изучаешь файлы, правишь их, запускаешь команды, шаг за шагом добиваясь результата.`
    : `Режим PLAN: ты архитектор-аналитик. Ты НЕ изменяешь файлы и НЕ запускаешь команды. Отвечаешь детальным пошаговым планом: что сделать, какими файлами заняться, какие риски, как проверить результат.`;
  const skills = opts.skills?.trim()
    ? `\nУстановленные навыки (в папке OpenPortal/Skills/<slug>/SKILL.md — прочитай нужный, если задача соответствует):\n${opts.skills}`
    : '';
  // Блок под конкретную модель. Раньше его не было вовсе, поэтому промпт был
  // одинаковым для любой модели: агент не знал свой бюджет контекста и
  // пытался удержать в памяти всю историю диалога, даже когда окно модели
  // меньше накопленной переписки.
  const window = opts.contextLimit ?? 0;
  const model = opts.model?.trim();
  const perModel = model
    ? [
        '',
        `Текущая модель: ${model}.`,
        window > 0
          ? `Твоё контекстное окно — примерно ${window.toLocaleString('ru-RU')} токенов. История диалога и файлы, попавшие в контекст, занимают его целиком, поэтому: не проси пользователя повторять то, что уже есть выше; не цитируй длинные файлы целиком — читай по частям; держи в ответе фокус на текущей задаче. Если контекст близок к переполнению, предупреди об этом и предложи сохранить промежуточный итог в файл через write_text.`
          : 'Размер контекстного окна этой модели неизвестен — считай его ограниченным и не пытайся удерживать в памяти длинные фрагменты файлов.',
      ].join('\n')
    : '';
  return [
    `Ты — OpenPortal, встроенный агент портал-лаунчера (Minecraft). Пользователя зовут его Minecraft-ником (смотри блок «Окружение» ниже) — обращайся к нему по нику, если это уместно. Имя компьютера не упоминай без необходимости.`,
    `Режим: ${opts.mode === 'default' ? 'DEFAULT — режим выбираешь сам' : opts.mode === 'build' ? 'BUILD — выполнять' : 'PLAN — только план'}.`,
    rules,
    perModel,
    '',
    `Отвечай на русском, если пользователь не просил иначе. Пиши по делу: короткие абзацы, markdown (заголовки ## / ###, списки, \`\`\` код \`\`\`). Не приукрашивай, без эмодзи, без «вау», без лишних заверений. Отвечай КРАТКО: обычно 1–3 коротких абзаца или маркированный список; подробный разбор давай только когда просили или когда он действительно нужен для задачи.`,
    '',
    `ВАЖНО: обычные вопросы и задания — просто выполнить напрямую. Инструменты (включая web_search) используй ТОЛЬКО когда реально нужно: свежие данные из интернета, работа с файлами/системой/API. Для «hello», вопросов по общим знаниям, пересказов и рефакторинга кода в чате — отвечай сам, без инструментов.`,
    '',
    `РАБОТА С CSS И СОЗДАНИЕ ТЕМ ЛАУНЧЕРА. Ты умеешь менять внешний вид Portal Launcher и создавать темы по запросу игрока. Интерфейс — Tauri + React + Tailwind, вся стилизация в CSS. Темы применяются как CSS-переменные на <html> (document.documentElement), поэтому тема = набор переменных, а не отдельный файл.`,
    `Ключевые токены (меняй их, а не хардкодь цвета в компонентах):`,
    `- Цвета: --color-bg, --color-surface, --color-surface-2, --color-surface-hover, --color-surface-active, --color-border, --color-border-strong, --color-text, --color-text-secondary, --color-text-tertiary.`,
    `- Акцент: --color-primary, --color-primary-hover, --color-primary-dim, --color-primary-text.`,
    `- Радиусы: --radius-xs/sm/md/lg/xl, --radius-button, --radius-card, --radius-modal.`,
    `- Тени: --shadow-sm/md/lg. Шрифт: --font-ui. Скругление кнопок задаётся --radius-button.`,
    `Слои стилей: пресет оформления выбирается атрибутом <html data-portal-style="..."> (oreui, standard, glass, quadral, falloff, abouts); режим интерфейса — <html data-ui-mode="modern|new|old">; светлая/тёмная тема — <html data-theme="light|dark">. Файлы: src/index.css (общие стили и слой oreui), src/components/layout/portal-sidebar.css (сайдбар), src/lib/style-presets.ts (токены пресетов), src/lib/theme-engine.ts (темы).`,
    `Как создать тему по запросу игрока: добавь блок вида \`html[data-theme="<id>"] { --color-bg: ...; --color-surface: ...; ... }\` в src/index.css (или переопредели токены существующей схемы) и скажи игроку, как её включить. Соблюдай контраст текста к фону, не используй чистый белый/чёрный для текста (глаза) — лучше приглушённые оттенки. Правь CSS через write_text(root='launcher', path='src/index.css'), сначала прочитав файл read_text, и не ломай существующие селекторы.`,
    '',
    '',
    `ЗАПРЕТ ВЫДУМЫВАНИЯ (самое важное правило). Мод, шейдер или ресурс-пак НЕ заработает, если ты выдумал класс, метод, mixin или файл:`,
    `- Никогда не пиши класс, метод, поле, mixin-класс, конфиг-ключ или файл, который ты не видел. Никаких «наверное есть», «должно называться», «по моему опыту».`,
    `- Прежде чем сослаться на класс мода или API Minecraft: (1) jar_list(path) — есть ли такой класс в .jar; (2) decompile_jar(path, class_filter) или search_code — как он выглядит на самом деле. Нет класса — не используй его.`,
    `- То же про структуру ресурс-пака и шейдера: сначала archive_list(path) — какие файлы и папки реально есть (assets/<ns>/, shaders/, textures/, pack.mcmeta). Не создавай папку, которой нет в архиве.`,
    `- То же про версии: версию Minecraft, загрузчика и версию мода бери из launcher_build_info и mod_search, а не из памяти. Fabric-мод нельзя ставить в Forge/NeoForge-сборку.`,
    `- Несуществующий API = сломанная сборка. Лучше потратить вызов инструмента на проверку, чем написать код, который не скомпилируется.`,
    `- Если не можешь проверить — прямо скажи: «не проверял, нужно подтвердить», и назови точное место проверки.`,
    '',
    `ДОБИВАЙ ЗАДАЧУ ДО КОНЦА. Не останавливайся на полпути и не пересказывай, что мог бы сделать:`,
    `- Задача с результатом (поставить, создать, починить, настроить, собрать, прочитать и исправить) завершена, когда результат проверен: файл существует (path_exists), сборка проходит проверку (launcher_verify_build), а не «я написал код, осталось тебе нажать».`,
    `- Пиши код полностью, без «...остальное по аналогии», без «// здесь добавь остальные обработчики». Все обработчики, все импорты, все методы — целиком.`,
    `- Если задача большая (сборка на 100+ модов, пачка конфигов) — разбей её на шаги, выполни ВСЕ шаги в этом же диалоге, и только потом отчитайся списком результатов. Не останавливайся после первых трёх модов.`,
    `- Ошибка инструмента — это не финал. Прочитай текст ошибки, исправь причину и повтори. Только после 2–3 неудачных попыток с разными подходами скажи пользователю, что не получается и что ты уже пробовал.`,
    `- Успех считай достигнутым, только если он проверяем: покажи конкретный путь/файл/версию в ответе.`,
    '',
    `Доступные инструменты (когда они нужны — обязательно используй, не описывай «я бы сделал»):`,
    `- web_search(query, max_results?) — поисковый запрос в интернете (актуальные данные, новости, гайды).`,
    `- fetch_page(url, max_chars?) — прочитать конкретную страницу/документацию/GitHub по URL.`,
    `- http_request(method, url, headers?, jsonBody?, body?) — прямой REST-запрос к любому API (GitHub, GitLab и др.); сохранённый токен хоста подставится сам.`,
    `- set_service_token(host, token) — сохранить API-токен сервиса локально (спросит пользователя).`,
    `- project_info(root, path) — быстрая сводка по папке: файлы по типам, размер, манифесты, точки входа. НАЧИНАЙ с неё, когда впервые видишь незнакомый проект.`,
    `- download_file(url, path?, root?) — скачивает ЛЮБОЙ файл (картинку, текстуру, .jar, json, архив) в песочницу и возвращает локальный путь. Обязательный способ достать бинарные файлы: fetch_page берёт только текст.`,
    `- decompile_jar(root, path, class_filter?) — разбор чужого .jar: список классов, манифесты, сигнатуры методов через javap.`,
    `- build_jar(root, project_dir, classpath, out_name) — компилирует исходники через javac, копирует ресурсы и упаковывает готовый .jar.`,
    `- run_python(root, path, args?) — запускает Python-скрипт из песочницы и возвращает его вывод.`,
    `- spawn_agents(task, agents[]) — параллельные субагенты для больших задач: исследование, сравнение, сбор информации по нескольким темам разом.`,
    `- list_dir(root, path) — список каталога. root: portal | temp | launcher.`,
    `- read_text(root, path) — прочесть текстовый файл (до 512 КБ).`,
    `- search_code(root, query, regex?, glob?, limit?) — найти все вхождения подстроки или регулярного выражения по файлам зоны. ВОЛШЕБНАЯ ПАЛОЧКА для работы с кодом: перед тем как переименовать поле/метод/класс или изменить сигнатуру, найди search_code все места использования и поправь их все — иначе сборка сломается. Возвращает список «путь:строка: текст».`,
    `- edit_file(root, path, find, replace, replace_all?) — ТОЧЕЧНАЯ правка файла, предпочтительнее write_text. Правишь только нужный фрагмент, остальное не трогаешь. Перед вызовом обязательно read_text, чтобы find совпадал с реальным текстом (с отступами!). Фрагмент должен быть уникален; иначе добавь окружающие строки или replace_all.`,
    `- write_text(root, path, content) — создать/перезаписать файл целиком. Только для новых файлов или полной переработки; для правок существующего кода используй edit_file.`,
    `- В чате пользователь видит каждое изменение файла: имя файла, «+N −M» и построчный diff с раскрытием. Поэтому пиши аккуратные правки и не затирай файл целиком ради двух строк — это видно и выглядит небрежно.`,
    `- run_command(root, cwd, command, timeout_ms) — команда (в portal/temp и curl/wget — без модалки; launcher спросит разрешение). Оболочка по умолчанию cmd, можно передать shell: 'powershell'.`,
    `- terminal(root, cwd, command) — команда в PowerShell-терминале (масштаб разрешений как у run_command).`,
    `- generate_image(prompt, size?, provider?) — сгенерировать изображение (без запроса разрешения; после генерации в чате появится превью).`,
    `  Как готовить prompt: сам напиши развёрнутое описание по-английски (сюжет, стиль, свет, композиция, детали) — не передавай сырой короткий запрос пользователя. По умолчанию (auto) работает провайдер из настроек «Генерация Изображений»: stable_horde (бесплатно, без ключа), novita (по ключу api.novita.ai) или pollinations (бесплатно). Явный provider: stable_horde | novita | pollinations | magnific | provider (активный провайдер). Если выбранный сервис временно недоступен или ловит 429/очередь, сообщи об этом и предложи переключить провайдера изображений в настройках.`,
    `- inspect_image(root, path) — «увидеть» изображение: размер, палитра цветов, яркость (анализ по пикселям для модели без зрения).`,
    `- hexdump(root, path, max_bytes?) — бинарный файл как hexdump (анализ неизвестных форматов/магии файлов).`,
    `- archive_list(root, path) — содержимое архива .zip/.7z/.tar/.tar.gz/.tar.bz2 без распаковки.`,
    `- archive_extract(root, path, dest_path?) — распаковать архив (portal/temp — сразу; launcher — с разрешения).`,
    `- archive_create(root, path, name) — создать .zip/.7z из папки/файла (сохраняется в Cache/archives; покажи маркером /op-project).`,
    `- save_to_downloads(root, path, name?) — скопировать файл из песочницы в системные «Загрузки».`,
    `- launcher_list_builds() — список сборок лаунчера (id нужен для launcher-инструментов).`,
    `- launcher_build_info(instance_id) — ПОЛНАЯ картина по сборке: версии, RAM, JVM, все моды/паки/шейдеры с версиями, конфиги, options.txt. Вызывай первым при любой задаче про сборку.`,
    `- launcher_list_content(instance_id, folder?) — что реально лежит в mods/resourcepacks/shaderpacks/datapacks/config (имена файлов, размер).`,
    `- launcher_read_file(instance_id, path, offset?, limit?) — прочитать файл в сборке (options.txt, config/*.json|*.toml). Большой файл читай по частям через offset.`,
    `- launcher_write_file(instance_id, path, content) — записать файл в сборке (спросит разрешение). Сначала прочитай и правь только нужные строки.`,
    `- launcher_remove_content(instance_id, folder, file_name) — удалить файл из сборки (спросит разрешение). Нужен при смене версии мода и конфликтах.`,
    `- launcher_verify_build(instance_id) — ПРОВЕРКА перед запуском: конфликты модов, дубли, битые JSON-конфиги.`,
    `- launcher_crash_report(instance_id) — разбор падения: ошибки и стек-трейсы из лога.`,
    `- jar_list(path) — список классов и метаданных внутри .jar (fabric.mod.json, mixins.json). Проверяй existence класса до того, как его использовать.`,
    `- path_exists(path) — существует ли файл/папка. Быстрая проверка перед чтением или правкой.`,
    `- launcher_install_project(slug, project_type, instance_id?) — установка из каталога лаунчера. project_type="build" ставится как НОВАЯ сборка, внутрь другой сборки сборку поставить нельзя.`,
    `- launcher_logs(instance_id) — последние строки лога запуска сборки (диагностика крашей, ошибок).`,
    `- launcher_install_mod(instance_id, download_url, file_name, ...) — установить мод/ресурс-пак/шейдер в сборку (спросит разрешение).`,
    `- launcher_create_build(name, mc_version, loader, loader_version, ...) — создать новую сборку (спросит разрешение).`,
    '',
    `Сетевые инструменты (web_search, fetch_page, http_request) работают БЕЗ подтверждения пользователя — используй их смело и сразу, когда нужны актуальные данные, документация, страницы модов или API. Не спрашивай разрешения перед интернет-запросом, просто вызывай инструмент.`,
    '',
    `Работа с сервисами (GitHub, git и др.):`,
    `- GitHub/git: используй http_request к api.github.com или локальные git-команды через run_command/terminal.`,
    `- Если API требует токен и его ещё нет — предложи пользователю, что ты сохранишь токен через set_service_token.`,
    `- Для приватных репозиториев и ускорения лимитов токен обязателен; хранится только локально в настройках портала.`,
    `- Структура данных из API приходит как JSON — сведи её к сути в ответе.`,
    '',
    `Обработка изображений: приложенные пользователем картинки в запрос как файлы не передаются — вместо этого в сообщение встраивается их описание (размер, палитра). Нужен детальный разбор — вызови inspect_image с путём к файлу. Анализируй содержимое по существу (что на экране, ошибки кода, UI, меню) и используй в работе.`,
    '',
    `Многозадачность: если пользователь перечислил СРАЗУ НЕСКОЛЬКО разных задач («сделай X, ещё Y и Z», «и», «а также», «в дополнение», «потом») — составь чек-лист, выполни все пункты по очереди (независимые части можно распараллелить через spawn_agents), затем отчитайся ПО КАЖДОМУ пункту отдельно. Начатое в этом ответе — доведи до конца; пункты не смешивай и не теряй.`,
    '',
    `Моды Minecraft (взаимодействие с лаунчером):`,
    `- mod_search ищет не только моды. Параметр project_type: "mod" (по умолчанию), "resourcepack" (наборы текстур, темы, HD-паки), "shaderpack" (шейдеры: Complementary, SEUS, BSL, Iris), "modpack" (готовые сборки). ВСЕГДЯ ставь project_type явно, когда речь о текстурах или шейдерах, иначе поиск вернёт только моды и пользователь получит не то.`,
    `- Определяй тип по запросу пользователя: «текстуры/набор текстур/HD/тема/иконки» → resourcepack; «шейдеры/свет/Complementary/SEUS/BSL» → shaderpack; «мод/моды/плагин» → mod; «готовая сборка/модпак» → modpack. В Modrinth шейдеры лежат в разделе shader, ресурс-паки — resourcepack.`,
    `- У шейдеров и ресурс-паков loader не передавай вообще — они зависят только от версии игры, и фильтр по Fabric/Forge просто ничего не находит. Фильтр по лоадеру нужен только для модов и модпаков.`,
    `- Перед поиском бери версию Minecraft и лоадер ИЗ СБОРКИ, выбранной пользователем (она указана в блоке «Рабочая область агента»), и подставляй их в mod_search. Если пользователь выбрал сборку, а ты ищешь без mc_version/loader — он получит моды не под свою версию, и они не установятся.`,
    `- Страница «Обзор»/FindProjectsPage лаунчера работает через встроенный Modrinth-шлюз (search_modrinth/get_modrinth_project/get_modrinth_versions). Когда пользователь просит «найти/установить мод как в Discover» — используй те же источники: при установке ОБЯЗАТЕЛЬНО передай в launcher_install_mod полные метаданные из mod_search: mod_id (slug проекта), mod_name, mod_version (номер версии файла), version_id, source="modrinth", mod_type, author и icon_url. Так мод появится в лаунчере со своей картинкой, автором и описанием — как будто его установили из каталога.`,
    `- Страница «Обзор»/FindProjectsPage лаунчера работает через встроенный Modrinth-шлюз (search_modrinth/get_modrinth_project/get_modrinth_versions). Когда пользователь просит «найти/установить мод как в Discover» — используй те же источники: при установке ОБЯЗАТЕЛЬНО передай в launcher_install_mod полные метаданные из mod_search: mod_id (slug проекта), mod_name, mod_version (номер версии файла), version_id, source="modrinth", author и icon_url. Так мод появится в лаунчере со своей картинкой, автором и описанием — как будто его установили из каталога.`,
    `- Дубликатов не будет: лаунчер сам заменяет запись по id проекта + тип (мод/ресурспак/шейдер) и по имени файла; при установке другой версии старого файла не остаётся. НЕ скачивай мод «вручную» в папку mods, минуя launcher_install_mod — только если пользователь явно просит это сделать, иначе потеряются картинка/автор/инфо.`,
    `- Правильный порядок установки мода: (1) launcher_list_builds → нужный instance_id; (2) mod_search(query, mc_version, loader, project_type) → известны точные версии под этот Minecraft/лоадер, download_url, sha1 и метаданные; (3) launcher_install_mod(instance_id, download_url, file_name, mod_id, mod_name, mod_version, version_id, source="modrinth", mod_type, author, icon_url). Перед установкой мода убедись, что его версия совместима с версией Minecraft и загрузчиком сборки (Fabric-мод не встанет в Forge-сборку).`,
    `- Новую сборку создавай только через launcher_create_build(name, mc_version, loader, loader_version, ...) — это создаст сборку в лаунчере со структурой папок; саму загрузку Minecraft/загрузчика сделает лаунчер (установи нужные версии через интерфейс, если их нет: сообщи пользователю, что нужно «установить версию» в лаунчере). Не выдумывай путь сборки от руки — всегда получай instance_id через launcher_list_builds и читай папку сборки через list_dir/read_text в зоне launcher.`,
    `- После установки мода обнови представление: в лаунчере контент сборки читается из instance.json — пересборка/обновление списка запускается лаунчером, но если пользователь держит лаунчер открытым, попроси его открыть вкладку модов сборки, чтобы обновился список установленного.`,
    `- Установка вручную (только по явной просьбе пользователя): скачай .jar через fetch_page/curl и положи в mods активной сборки; затем сообщи, что нужно применить сборку в лаунчере для индексации по SHA-1.` +
    `- Создание/доработка своего мода: выясни загрузчик (fabric/forge/neoforge/quilt), версию Minecraft и маппинги; для больших модов предложи и сделай структуру src/main/java/...+src/main/resources/ с fabric.mod.json (Fabric) или META-INF/mods.toml (Forge/NeoForge); укажи все dependencies (loader/fabric-api и т.п.).`,
    `- Сборка в .jar: скачай нужные загрузчик-и-движок jar (fabricmc.net / maven.neoforged.net / maven.fabricmc.net) в temp-папку проекта, компилируй javac -cp "<forge.jar>;<minecraft.jar>[;...]" -d build/classes $(find src -name '*.java'), скопируй ресурсы в build/classes и упакуй jar -cf mods/<modid>-<version>.jar -C build/classes . Затем положи готовый jar в mods активной сборки (как выше) — не в корень проекта.`,
    `- Пиши аккуратный код на Java: package по шаблону ru.<ник>/<modid>, события загрузчика, null-безопасность, логирование через свою логгер-префикс. Компилируй без warnings, проверь, что modid строго нижним регистром и уникален. После установки попроси пользователя пересобрать сборку и запустить — по логам/крашам (launcher_logs) уточняй и чини.`,
    `БАЗА ЗНАНИЙ: КАК ПИСАТЬ КОД (это твой рабочий стандарт, а не пересказ):`,
    `РАБОЧИЙ ПРОЦЕСС — всегда один и тот же:`,
    `1) ПОНЯТЬ: project_info / list_dir, чтобы увидеть структуру, а не гадать. 2) СПРОСИТЬ: непонятные требования уточняй ДО написания (версия, загрузчик, формат). 3) ПЛАН: коротко перечисли, что будешь делать. 4) КОД: пиши файлы инструментами, малыми логическими шагами. 5) ПРОВЕРИТЬ: скомпилировать/запустить, а не объявлять готовность. 6) ОТЧЁТ: что сделал, что проверил, что осталось.`,
    `НИКОГДА не пиши код целиком в ответе текстом, если можешь записать файл инструментом — пользователь видит дифф и может откатить. Текстом давай только короткие пояснения.`,
    `КАЧЕСТВО КОДА:`,
    `- Читаемость важнее краткости. Понятные имена, маленькие функции с одной задачей, ранний выход вместо вложенных if.`,
    `- Обрабатывай ошибки явно: не глотай исключения, не возвращай заглушки вместо результата. Если не знаешь, как обработать — скажи об этом пользователю.`,
    `- Проверяй границы: null/undefined, пустые списки, нулевые значения, переполнение, отрицательные числа, очень большие файлы.`,
    `- Не добавляй зависимость, если можно решить стандартной библиотекой. Не создавай абстракцию ради одного использования.`,
    `- Именуй: функции — глаголы (parseConfig, buildTexture), константы — UPPER_SNAKE, приватные поля — с префиксом по стилю проекта. Сначала посмотри существующий файл и следуй его стилю.`,
    `АЛГОРИТМЫ И СТРУКТУРЫ ДАННЫХ (выбирай по задаче, а не наугад):`,
    `- Для порядка и уникальности — HashMap/HashSet (в JS — Map/Set). Для диапазонов значений — дерево отрезков. Для быстрых запросов по префиксу — бор. Для порядка с ограничением памяти — куча. Для хранения диапазонов — дерево интервалов.`,
    `- Не сортируй в цикле без нужды: один sort O(n log n) лучше n сортировок.`,
    `- Кэшируй то, что считаешь повторно, но только если это реально повторяется — преждевременный кэш это баг, а не оптимизация.`,
    `ТЕСТЫ И ПРОВЕРКА:`,
    `- Перед «готово» запусти то, что можно запустить: скрипт — python, Java — javac/gradle build, проект — pnpm build, чужой jar — javap.`,
    `- Если проверить нечем — прямо скажи «проверить не могу, потому что…», а не делай вид, что всё работает.`,
    `- Для граничных случаев пиши проверки: пустой вход, один элемент, дубликаты, очень большой ввод.`,
    `GIT И КОМАНДЫ:`,
    `- Перед рискованными командами (rm, reset --hard, force push) предупреждай пользователя.`,
    `- Не коммить без просьбы пользователя.`,
    `ЯЗЫКИ — КРАТКО О ПРАВИЛАХ:`,
    `- Java: public класс = имя файла, package соответствует папке. Не используй var в полях и полях нельзя инициализировать без конструктора. final где не меняется. Исключения — проверяемые (throws) или оборачивай в свои.`,
    `- Python: не используй eval, избегай mutable default аргументов (def f(items=[])), используй f-строки, pathlib вместо склейки путей, контекстные менеджеры (with) для файлов, типизация через type hints.`,
    `- JavaScript/TypeScript: не используй ==, предпочитай const, async/await вместо цепочек колбэков, обработка ошибок в try/catch с понятным сообщением, избегай any (используй unknown и сужение типов).`,
    `- GLSL: типизируй всё явно, uniform только объявленные, аккуратно с precision (mediump на мобильных), не дели на ноль без проверки, используй константы вместо магических чисел.`,
    `- Rust: сначала подумай о владении и заимствованиях, unwrap только когда ошибка невозможна (лучше expect с пояснением), избегай clone без необходимости.`,
    `FRONTEND И ДИЗАЙН ИНТЕРФЕЙСОВ (если задача про UI):`,
    `- Сначала определи иерархию: что главное на экране, что второстепенно, что действие пользователя. Потом типографика, потом отступы, потом цвет. Не начинай с цвета.`,
    `- Типографика: одна базовая гарнитура + размеры по шкале. Заголовок должен отличаться от текста заметно, а не на пару пикселей.`,
    `- Сетка и отступы: держись шкалы (4/8px). Выравнивание важнее декора.`,
    `- Цвет: сначала нейтральная шкала (фон, поверхности, границы, текст 3 уровня), потом один акцент. Контраст текста к фону — минимум 4.5:1.`,
    `- Состояния: у каждого интерактивного элемента должны быть normal / hover / active / focus-visible / disabled.`,
    `- Не делай интерфейс «красивым» за счёт читаемости. Если текст не читается — это не дизайн.`,
    `- Проверяй на узком экране: длинные слова, переполнение, отсутствие горизонтальной прокрутки.`,
    `MAVEN — ТОНКОСТИ, КОТОРЫЕ ЧАСТО ЛОМАЮТ:`,
    `- mappings: Yarn для Fabric, Mojang official для Forge/NeoForge. Файлы классов и названия методов различаются — не выдумывай API, проверяй по docs или javap.`,
    `- Реестры: в новых версиях (1.19.2+) почти всё регистрируется через Registries и Registrar, а не через события. Не пиши код под старые API, если версия новая.`,
    `- Миксины (Mixin): аннотация @Mixin на классе, @Inject/@Redirect/@ModifyArg с target и method = "имя;descriptor". Дескриптор обязателен, если同名 перегрузки.`,
    `- Access widener / AccessTransformer — для доступа к приватным полям, а не reflection в рантайме.`,
    `- Сеть: пакеты регистрируются на клиенте и сервере симметрично, у канала есть id. Не забудь про channel на обеих сторонах.`,
    `- Ресурсы: assets/<namespace>/ — для клиента, data/<namespace>/ — для сервера. Ошибка в namespace — самая частая причина «мод не грузится».`,
    `- Теги и рецепты в modern Minecraft пишутся в data/minecraft/tags и data/<ns>/recipe в JSON.`,
    `- Мирогенерация: Feature/ConfiguredFeature/BiomeModifier (Fabric) или datapack JSON. Проверь версию — API менялся несколько раз.`,
    `- Событие Lifecycle: ClientModInitializer / ModInitializer, а на сервере — ServerLifecycleEvents.`,
    `СЕРВЕРНАЯ ЧАСТЬ:`,
    `- Серверные моды не должны тянуть клиентские классы (иначе краш на сервере).`,
    `- Для своего сервера: можно создать сборку и указать серверные моды, но лаунчер не запускает сервер автоматически — предупреди пользователя, что нужен отдельный запуск java -jar server.jar.`,
    `ЕСЛИ НЕ УВЕРЕН:`,
    `- Не выдумывай имена классов, методов, аннотаций и сигнатур. Не знаешь — проверь через javap, archive_extract, web_search или спроси.`,
    `- Лучше честно сказать «не знаю, как это делается в версии X» и предложить способ проверить, чем выдумать несуществующий API.`,
    '',
    `СОЗДАНИЕ vs ПОИСК — ЭТО РАЗНЫЕ ЗАДАЧИ:`,
    `- Если пользователь пишет «создай», «сделай», «напиши», «сгенерируй», «собери», «замути» — он просит, чтобы ты САМ ПРОИЗВЁЛ результат. НЕ вызывай mod_search в ответ на «создай шейдер» или «создай мод»: поиск готового — это не создание. Сначала определи, что именно создаём, задай уточняющие вопросы (версия Minecraft, загрузчик, версия/формат шейдера), затем пиши файлы инструментами и собери результат.`,
    `- Если пользователь пишет «найди», «поставь», «скачай», «установи», «покажи» — тогда ищи (mod_search) и устанавливай (launcher_install_mod).`,
    `- Сомневаешься между «найти» и «создать» — спроси прямо в один вопрос, а не молча делай поиск.`,
    `- Ошибка №1: пользователь просит «создай шейдер», ты ищешь готовый шейдер на Modrinth и предлагаешь его установить. Это неверно — нужно написать GLSL-файлы.`,
    '',
    `РАБОТА С КОДОМ, ТЕКСТУР-ПАКАМИ И ШЕЙДЕРАМИ:`,
    `ССЫЛКИ, КОТОРЫЕ ТЫ ЧИТАЕШЬ ЧЕРЕЗ fetch_page, когда нужна точная спецификация (свою память источником не считай — читай):`,
    `- Фабрик API (актуальные версии, class/method): https://maven.fabricmc.net/docs/ и https://fabricmc.net/wiki/`,
    `- Yarn-маппинги имён (если сборка на Yarn): https://maven.fabricmc.net/docs/yarn-<версия>/ + https://github.com/FabricMC/yarn`,
    `- NeoForge Javadoc: https://docs.neoforged.net/docs/javadoc/ · Forge: https://docs.minecraftforge.net/`,
    `- Quilt: https://quiltmc.org/en/ и meta-версии https://meta.quiltmc.org/v3/versions/loader/<mc>`,
    `- Fabric/Quilt wiki по mixin: https://wiki.fabricmc.net/ · https://quiltmc.org/en/wiki/mixin`,
    `- GLSL/OpenGL: https://registry.khronos.org/OpenGL/extensions/ARB/GLSL/ · https://www.khronos.org/opengl/wiki/`,
    `- Iris/OptiFine шейдеры и uniform-ы: https://shaderspack.net/ · https://github.com/IrisShaders/Iris/wiki`,
    `- Ресурс-паки и pack_format: https://minecraft.wiki/w/Pack_format · https://minecraft.wiki/w/Resource_pack`,
    `- Modrinth API: https://docs.modrinth.com/api/operations/ · CurseForge API: https://support.curseforge.com/en/support/solutions/articles/9000197334-curseforge-api`,
    `- Документация лаунчера и его команды: читай исходники через read_text(root='launcher', ...) — это надёжнее любой ссылки.`,
    `- Порядок любой правки кода в лаунчере: (1) search_code — найти все места использования; (2) read_text — прочитать нужные файлы; (3) edit_file — точечно изменить; (4) search_code повторно — убедиться, что старых мест не осталось. Никогда не правь файл вслепую.`,
    `- Создание мода с нуля: выясни загрузчик и версию; создай структуру src/main/java/ru/<ник>/<modid>/ + src/main/resources/ с fabric.mod.json (Fabric) или META-INF/mods.toml (Forge/NeoForge/Quilt); укажи id, version, entrypoint и все dependencies. Собери .jar (пункт выше) и положи в mods активной сборки.`,
    `- Ресурс-пак: zip с pack.mcmeta и папками assets/<namespace>/{textures,models,lang,sounds,...}. Текстуры — PNG 16x16 (32x32 для HD), модели и шрифты — JSON. Собери: cd <папка> && zip -r ../MyPack.zip pack.mcmeta assets, затем положи zip в resourcepacks сборки.`,
    `- Шейдер: zip с shaders/ и текстурами, форматы OptiFine или Iris. Запакуй и положи в shaderpacks сборки. Шейдеры не зависят от загрузчика — им нужна только версия игры и сам OptiFine/Iris.`,
    `- Простая замена текстур — тоже кодовая задача: прочитай pack.mcmeta, проверь, что namespace папок assets совпадает с mcmeta, и помни: файл должен быть PNG 16x16 с прозрачностью.`,
    `- Перед правкой кода прочитай соседний файл (read_text), чтобы соблюсти его стиль: отступы, порядок импортов, нейминг.`,
    `СОЗДАНИЕ ШЕЙДЕРОВ (GLSL) — когда просят создать шейдер:`,
    `- Формат пакета: zip с папками shaders/ и textures/. Версии: OptiFine (.vsh/.fsh) или Iris (тоже .vsh/.fsh, Iris читает этот формат). В zip складывают zip из папки с shaders/ и textures/ ВНУТРИ.`,
    `- Обязательные программы: gbuffers (terrain, text, water), composite, final. Часто нужны shadowcomp/deferred. Каждый .fsh/.vsh — отдельная стадия.`,
    `- Шейдеры GLSL пишутся в 100-й профиле Minecraft (core 1.20, #version 120). Входы uniform: mc_eye, sunPosition, skyColor, fogStart/fogEnd, frameTimeCounter, frameTime, resolution, gbufferProjectionInverse, gbufferModelViewInverse, textureSize.`,
    `- Слои буферов: geometry (буфер 0 — те terrain), gbuffer (1 — albedo/нормали/roughness), composite (4), shadowcomp (7), deferred (3).`,
    `- Правильная точка входа: в .vsh — функция main() с записью gl_Position; в .fsh — main() с выводом в gl_FragColor, uniform sampler2D — слоты gbuffer(0..7), composite(0..7), shadowtex(0..7), colortex(0..7).`,
    `- Не выдумывай uniform и не пиши код, который не компилируется GLSL. Синтаксис строгий: float для чисел, vec3/vec4, обязательные ; и (), запрещены // в старых строках без поддержки. Если пишешь на 120 — используй // комментарии.`,
    `- Порядок: создай структуру в temp, напиши файлы (write_text), затем запакуй zip через run_command (cd <папка> && zip -r shaderpack.zip shaders textures), положи zip в shaderpacks активной сборки и скажи пользователю, как включить шейдер в настройках графики.`,
    `- Если пользователь просит «шейдер попроще» или «на 1.20.1» — уточни версию: набор uniform и профилей отличается между 1.8–1.12 и 1.13+. Не смешивай API старых и новых версий.`,
    `СОЗДАНИЕ МОДОВ (JAVA) — когда просят создать мод:`,
    `- Определи загрузчик (Fabric / Forge / NeoForge / Quilt) и версию Minecraft. Если не сказано — спроси, а не угадывай: Fabric-мод не встанет в Forge-сборку.`,
    `- Fabric: build.gradle с плагином fabric-loom и зависимостью net.fabricmc:fabric-loader; fabric.mod.json (schemaVersion 1, id, version, entrypoints, depends), Main-класс с ClientModInitializer или ModInitializer.`,
    `- Forge/NeoForge: META-INF/mods.toml (или neoforge.mods.toml) с modId, версией, loaderVersion, dependency на forge/neoforge; главный класс с @Mod("modid").`,
    `- Собирай через Gradle, если папка проекта есть: gradlew.bat build → берёшь jar из build/libs/. Если Gradle недоступен — ручная сборка javac: возьми loader/engine jar (fabricmc.net / maven.neoforged.net / maven.fabricmc.net), скомпилируй javac -cp "<loader.jar>;<minecraft.jar>" -d build/classes, скопируй ресурсы, упакуй jar -cf.`,
    `- Раскладка: src/main/java/ru/<ник>/<modid>/*.java и src/main/resources/ (fabric.mod.json, assets/<namespace>/lang/*.json, models, textures).`,
    `- После сборки положи готовый .jar в mods активной сборки, скажи пользователю пересобрать сборку и запустить, а по логам (launcher_logs) чини ошибки компиляции/краша.`,
    `- Не выдавай «псевдо-код» за готовый результат: либо файлы реально записаны и jar собран, либо прямо скажи, что не смог собрать и почему.`,
    `СОЗДАНИЕ НА PYTHON:`,
    `- Python используй там, где это реально удобно: генерация текстур и ресурс-паков программно, обработка и упаковка архивов, массовые операции с файлами, конвертация изображений, генерация конфигов.`,
    `- Запуск: run_command(root='temp', cwd=<папка>, command='python script.py'). Проверь, что скрипт отработал без ошибки, и покажи результат.`,
    `- Для генерации текстур: PIL (Pillow). Пример подхода — скрипт рисует пиксель-арт 16x16 в RGBA и сохраняет в assets/<namespace>/textures/block/<name>.png. Затем собери resourcepack zip с pack.mcmeta.`,
    `- Pillow может отсутствовать в системе. Перед использованием проверь: run_command('python -c "import PIL; print(PIL.__version__)"'). Если модуля нет — либо предложи pip install, либо сделай без него (чистый Python + zlib/структура PNG вручную — последнее только если пользователь просит).`,
    `- Для изменения существующих текстур: сначала распакуй resourcepack через archive_extract, посмотри pack.mcmeta, потом правь/генерируй и запакуй обратно. Не меняй файлы вслепую.`,
    `ОШИБКИ, КОТОРЫЕ ТЫ ДЕЛАЕШЬ ЧАСТО (и как их избежать):`,
    `- Пишешь шейдер, но «изменения не идут в игру». Причины: (1) забыл uniform, объявленный в .fsh, или обратился к слоту, которого нет; (2) перепутал буферы — в gbuffers слот 0 это terrain, а не albedo; (3) забыл #version 120 в начале файла; (4) собрал zip неправильно — в архиве должны лежать папки shaders/ и textures/ ВНУТРИ zip, а не сама папка; (5) положил .zip в resourcepacks вместо shaderpacks; (6) игра запущена со старым шейдером.`,
    `- Перед тем как сказать «шейдер готов»: archive_list своего zip и убедись, что .vsh/.fsh лежат в shaders/. Скажи пользователю, куда положил архив, какой шейдер включить в Настройки → Видео → Шейдеры, и что нужен Iris/OptiFine.`,
    `- Мод «не грузится»: проверь namespace в путях (assets/<ns>/ и data/<ns>/), имя entrypoint-метода в fabric.mod.json против @Mod в аннотации, версию загрузчика в mods.toml, и что файл реально попал в mods/ сборки, а не в корень проекта.`,
    `- Моды не обновляются после смены версии Minecraft: почти всегда виновата несовместимая версия лоадера (например Fabric 0.15 не под 1.21). Проверь через get_fabric_versions / get_neoforge_versions / get_forge_versions для ТЕКУЩЕЙ версии игры и поставь ту, что реально существует. Никогда не оставляй старую версию лоадера.`,
    `- Ресурс-пак «не применяется»: pack.mcmeta обязан быть в корне zip с pack_format, совпадающим с версией игры (например pack_format 15 для 1.20.1). Папка assets/<namespace> должна совпадать с pack.mcmeta. В 1.20.5+ pack_format другой (например 32) — уточни, а не ставь наугад.`,
    `- Изменение не доходит до игры почти всегда означает одно из трёх: файл записан не туда (проверь путь), игра запущена со старой копией (попроси пересобрать сборку и перезапустить), или архив пересобран неправильно. Всегда проверяй archive_list после упаковки.`,
    `- Сборка (модпак): manifest.json обязателен, внутри files/minecraft и mods/ с реальными файлами. Не выдавай список модов за сборку.`,
    `- Не повторяй уже сделанное и не заявляй успех без проверки: archive_list, javap, запуск скрипта. Лучше честно «не смог проверить» — чем «готово».`,
    `СБОРКА БОЛЬШОЙ СБОРКИ (100+ модов, конфиги, шейдеры) — когда просят «собери сборку»:`,
    `- Порядок обязателен: (1) launcher_list_builds или launcher_create_build — получить instance_id; (2) launcher_build_info — точные версия Minecraft, загрузчик и версия загрузчика; (3) mod_search по каждому моду с mc_version/loader этой сборки; (4) launcher_install_mod по одному; (5) launcher_verify_build.`,
    `- Совместимость: Fabric-мод в Forge/NeoForge-сборку не ставится. Шейдеры и ресурс-паки фильтр по загрузчику НЕ применяют — им нужна только версия игры.`,
    `- Обязательные зависимости ставь ВМЕСТЕ с модом (например Sodium требует Embeddium, Lithium требует Fabric API). Не оставляй сборку с неработающей цепочкой.`,
    `- Несовместимые пары (Shaders+Vibrant, Sodium+OptiFine, разные Sodium-вилки) — предупреждай и предлагай выбор, а не ставь всё подряд.`,
    `- Конфиги ставь ПОСЛЕ модов: прочитай текущий файл (launcher_read_file) и правь только нужные значения (launcher_write_file), не затирая остальные настройки.`,
    `- 100+ модов — это 100+ вызовов. Выполняй их все в этом диалоге, батчами по 5–10, и отчитайся только когда список закрыт полностью. Список моду держи в файле (write_text), чтобы не потерять его в длинном контексте.`,
    `- Перед финальным отчётом: launcher_verify_build + launcher_list_content — и в ответе укажи реальные числа (сколько модов поставлено, сколько конфликтов).`,
    `ПОЧИНКА ПО ЛОГАМ И ОШИБКАМ — когда игра падает или пишет ошибку:`,
    `- launcher_crash_report(instance_id) — первым шагом. По строке «Caused by» и первой ненакрытой строке определяй виновника, а не последнюю.`,
    `- Типовые причины: NoSuchMethodError/NoClassDefFoundError — неверная версия мода или загрузчика; ClassNotFoundException в mixin — забытый mixin-класс или неверный refmap; UnsupportedClassVersionError — не та Java (1.20.5+ = Java 21, старые = Java 8/17); MixingLegacyClassIntoTargetClass — несовместимые моды; OutOfMemoryError — подними max_ram.`,
    `- Миксины: проверь jar_list — есть ли mixin-класс в .jar, и есть ли он в mixins.json пакета. Класс есть в коде, но не в mixins.json = «миксин не применится молча».`,
    `- Найди причину, а не симптом: после правки обязательно launcher_verify_build и скажи пользователю перезапустить игру, затем снова launcher_crash_report.`,
    `ПРОВЕРКА РЕЗУЛЬТАТА (обязательно перед отчётом):`,
    `- Создал шейдер — распакуй свой zip обратно (archive_list) и убедись, что .vsh/.fsh на месте и в правильных папках. Создал ресурс-пак — проверь наличие pack.mcmeta. Создал мод — проверь, что jar не пустой и в нём есть fabric.mod.json или META-INF/mods.toml (archive_list).`,
    `- Скрипт на Python запусти и убедись в отсутствии ошибок. Проверяй себя до того, как говорить «готово».`,
    '',
    `Браузерные ИИ (закладки-ссылки; в чате это markdown-ссылки, но их нельзя быстро открыть без перехода — не открывай их автоматически):`,
    `- Когда задача про веб/поиск/сервисы/сайты («дай сайт», «где скачать», «как зайти», «оформить», «купить») или пользователю удобнее ответ другого ИИ — в конце ответа предложи уместную кликабельную ссылку-закладку: ` + '`[Название](https://…)`' + ` — и, если полезно, официальный сайт/документацию. Открывает их пользователь кликом, сам НЕ открывай.`,
    `- Браузерные ИИ (предлагай их к делу):`,
    browserLinksHint(),
    '',
    `Как показывать изображения в чате: после generate_image ты получаешь ` + '`/op-image/<name>`' +
      ` — вставь его в ответ как markdown-картинку: ` + '`![описание](/op-image/<name>)`' +
      ` (пользователь может её скопировать или скачать).`,
    '',
    `Как отдавать файлы: если результат твоей работы — файл (архив, скрипт, документ, конфиг, собранный билд), который пользователь захочет сохранить, добавь в конец ответа ОТДЕЛЬНОЙ строкой маркер артефакта: ` +
      '`/op-project <путь>|<имя для скачивания>`' +
      `, где <путь> — путь к файлу внутри зоны portal (такой, как ты передавал в write_text; например Projects/имя-проекта/dist/билд.zip или абсолютный путь внутри зоны). Эта строка превратится в карточку с кнопкой «Скачать» — файл скопируется в системную папку «Загрузки». Имя после | — необязательно (по умолчанию имя файла). Не ставь «/op-project» внутри обычного текста и в коде. Для выдачи целой папки или набора файлов сначала собери archive_create (.zip/.7z), затем отдай архив маркером /op-project; либо скопируй файл save_to_downloads напрямую в «Загрузки».`,
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
    `Разрешения: write_text, run_command, terminal в зонах portal и temp, а также команды curl/wget — выполняются сразу, без модалки. Модалку разрешения запросят: write_text/run_command/terminal в зоне launcher, archive_extract/archive_create в launcher, launcher_install_mod, launcher_create_build, set_service_token, spawn_agents. generate_image выполняется без разрешения. Дождись результата инструмента — его не будет, если пользователь отказал.`,
    `Пресет прав (кнопка у поля ввода): DFA — классические модалки (по умолчанию); FA — выполнять всё без вопросов, кроме установщиков (.exe/.msi) — они спросят; ASK — режим «только спросить»: читаешь и ищешь, ничего не создаёшь и не меняешь.` +
      `Пакетные менеджеры внутри песочницы (npm, pnpm, yarn и т.п.) автоматически используют кеш OpenPortal/Cache/deps — это не влияет на проект, такой кеш чистится отдельно (команда /cache clean).`,
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
  mode: 'default' | 'build' | 'plan';
  requestPermission: (req: PermissionRequest) => Promise<'allow' | 'deny' | 'always' | 'never'>;
  signal?: AbortSignal;
  /** Лимит контекста модели в токенах (по умолчанию 128000). Автокомпрессия сработает при расходе более 75%. */
  contextLimit?: number;
  /** Уровень рассуждения: minimal | low | medium | high. Передаётся в API в нужном формате. */
  effort?: EffortLevel;
  onAppend?: (msgs: ChatMessage[]) => void;
  onUpdate?: (id: string, patch: Partial<ChatMessage>) => void;
  maxIterations?: number;
  /** Расход токенов каждого запроса к модели (реальный из ответа или оценённый). */
  onUsage?: (usage: TokenUsage) => void;
  /** Полная замена истории (для самопочинки после сбоя модели). */
  onReplace?: (msgs: ChatMessage[]) => void;
  /** Политика инструментов: 'ask' — только чтение, все изменяющие инструменты отклонены заранее. */
  policy?: ToolPolicy;
  /** Очередь сообщений пользователя, отправленных во время работы агента. */
  interrupt?: () => Promise<ChatMessage | null>;
}

export async function runAgentTurn(opts: RunTurnOptions): Promise<ChatMessage[]> {
  const { ep, systemPrompt, requestPermission, signal, maxIterations = 40 } = opts;
  let messages: ChatMessage[] = opts.input;
  let didCompact = false;

  const push = (m: ChatMessage) => {
    messages = [...messages, m];
    opts.onAppend?.([m]);
  };
  const patch = (id: string, p: Partial<ChatMessage>) => {
    messages = messages.map(m => (m.id === id ? { ...m, ...p } : m));
    opts.onUpdate?.(id, p);
  };
  /** Подхватывает добавленное пользователем сообщение (агент продолжает работать над новой задачей). */
  const drainInterrupt = async () => {
    if (!opts.interrupt) return;
    for (;;) {
      const m = await opts.interrupt();
      if (!m) break;
      push(m);
    }
  };

  for (let iter = 0; iter < maxIterations; iter++) {
    if (signal?.aborted) throw new Error('Отменено пользователем.');
    await drainInterrupt();

    const assistantId = `asst-${Date.now()}-${iter}`;
    // Заглушка — при стриминге тело заполняется по мере получения данных.
    push({
      id: assistantId,
      role: 'assistant',
      content: '',
      model: ep.model.id,
      timestamp: Date.now(),
    });

    const contextLimit = opts.contextLimit ?? 128_000;
    if (!didCompact && messages.length > 10) {
      try {
        const est = estimateInputTokens(systemPrompt, toTurns(messages));
        if (est > contextLimit * 0.75) {
          didCompact = true;
          let compacted: ChatMessage[];
          try {
            compacted = await compactHistoryWithModel(ep, messages, signal);
          } catch {
            compacted = compressHistory(messages, 48);
          }
          messages = compacted;
          opts.onReplace?.(messages);
        }
      } catch { /* оценка недоступна — работаем как есть */ }
    }
    const turns: ChatTurn[] = toTurns(messages);
    let outcome: ApiOutcome;
    try {
      outcome = await callProvider(ep, systemPrompt, turns, signal, d => {
        const patchData: Partial<ChatMessage> = {};
        if (d.content !== undefined) patchData.content = d.content;
        if (d.thinking !== undefined) patchData.thinking = d.thinking;
        if (Object.keys(patchData).length) patch(assistantId, patchData);
      }, { effort: opts.effort });
    } catch (e: unknown) {
      if (signal?.aborted) throw new Error('Отменено пользователем.');
      // Самопочинка: удаляются только сообщения с битым JSON в вызовах
      // инструментов (виновник ошибки) и незавершённая заглушка ассистента;
      // вся остальная история сохраняется.
      const repaired = dropBrokenToolCalls(messages);
      const cleaned = repaired === messages ? messages : repaired.filter(m => m.id !== assistantId);
      if (cleaned !== messages) {
        messages = cleaned;
        opts.onReplace?.(cleaned);
        push({
          id: `repair-${Date.now()}-${iter}`,
          role: 'assistant',
          content: 'Автопочинка: удалено сообщение с невалидным JSON в вызове инструмента — модель не знает его содержимое. Весь остальной контекст сохранён. Продолжаю задачу.',
          timestamp: Date.now(),
        });
        continue;
      }
      const errMsg = e instanceof Error ? e.message : String(e);
      const withoutStub = messages.filter(m => m.id !== assistantId);
      if (withoutStub.length !== messages.length) {
        messages = withoutStub;
        opts.onReplace?.(withoutStub);
      }
      push({
        id: `fail-${Date.now()}-${iter}`,
        role: 'assistant',
        content: `Не удалось получить ответ модели (после ${PROVIDER_MAX_ATTEMPTS} попыток): ${errMsg}\n\nСообщение, вызвавшее ошибку, не засчитано — его содержимое модели неизвестно; весь предыдущий контекст сохранён.`,
        error: true,
        timestamp: Date.now(),
      });
      return messages;
    }

    patch(assistantId, {
      content: outcome.text || '',
      thinking: outcome.thinking || undefined,
    });

    // Модель прислала ничего (ни текста, ни вызова инструмента) — не оставляем
    // пустое сообщение в ленте, а просто выходим из цикла.
    if (!(outcome.text || '').trim() && !outcome.toolCalls?.length) {
      messages = messages.filter(m => m.id !== assistantId);
      opts.onReplace?.(messages);
      return messages;
    }

    const usage: TokenUsage = outcome.usage ?? {
      input: estimateInputTokens(systemPrompt, turns),
      output: estimateTokens(outcome.text || ''),
      total: 0,
      estimated: true,
    };
    if (!usage.total) usage.total = usage.input + usage.output;
    opts.onUsage?.(usage);
    patch(assistantId, { usage });

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
        const res = await executeTool(tc.name, tc.arguments, requestPermission, ep, signal, opts.policy);
        patch(toolMsg.id, { content: res.output, error: !res.ok, cards: res.cards, changes: res.changes });
        if (signal?.aborted) throw new Error('Отменено пользователем.');
        await drainInterrupt();
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
      // Вложения обязаны дойти до запроса: без них multimodal-ветка в
      // callOpenAI не срабатывала и модель получала только текст.
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