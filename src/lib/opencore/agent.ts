import { invoke } from '@/lib/invoke-shim';
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
      'Читает любую веб-страницу по URL и возвращает её текст (markdown/HTML без побочных стилей). ' +
      'Используй для документации, GitHub README, страниц модов, release-нот и т.п.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Полный URL страницы' } },
      required: ['url'],
    },
    root: '*',
    requiresPermission: false,
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

async function execWebFetch(args: { url: string }): Promise<ExecResult> {
  if (!/^https?:\/\//i.test(args.url)) {
    return { ok: false, output: 'Некорректный URL — только http/https.' };
  }
  const res = await invoke<FetchResult>('op_web_fetch', { url: args.url });
  if (!res.ok || (res.text.length === 0 && res.error)) {
    return { ok: false, output: `HTTP ${res.status}: ${res.error ?? 'пустой ответ'}` };
  }
  return { ok: true, output: `HTTP ${res.status}\n${res.text}` };
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
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ep.apiKey}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, output: `Сеть: ${String(e)}` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, output: `${ep.provider.name} вернул HTTP ${res.status}: ${text.slice(0, 400)}` };
  }
  const data: any = await res.json().catch(() => null);
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

export async function executeTool(
  tool: string,
  argsRaw: string,
  requestPermission: (req: PermissionRequest) => Promise<'allow' | 'deny' | 'always' | 'never'>,
  ep: ResolvedEndpoint,
): Promise<ExecResult> {
  let args: any;
  try {
    args = JSON.parse(argsRaw || '{}');
  } catch {
    return { ok: false, output: 'Не удалось разобрать аргументы инструмента (JSON).' };
  }

  if (tool === 'web_search') {
    if (!args.url) return { ok: false, output: 'Нет аргумента url.' };
    return execWebFetch(args);
  }

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
}

export function resolveEndpoint(
  providerId: string,
  modelId: string,
  providersState: Record<string, { apiKey?: string; baseUrl?: string }>,
): ResolvedEndpoint {
  const preset = OP_PROVIDERS.find(p => p.id === providerId);
  const st = providersState?.[providerId] ?? {};
  const isCustom = providerId.startsWith('custom:');

  let baseUrl: string;
  let kind: ProviderKind = preset?.kind ?? 'openai';
  let model: ModelDef;

  if (preset) {
    baseUrl = st.baseUrl || preset.baseUrl || '';
    model = preset.models.find(m => m.id === modelId) ?? { id: modelId };
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

  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {}),
      ...(ep.provider.id === 'openrouter' ? { 'HTTP-Referer': 'https://portal-launcher.app', 'X-Title': 'OpenPortal' } : {}),
    },
    body: JSON.stringify(body),
  });
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
  const toolCalls: ToolCall[] | undefined = (msg?.tool_calls ?? []).map((tc: any) => ({
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
  };
  if (ep.apiKey) headers['x-api-key'] = ep.apiKey;

  const res = await fetch(url, { method: 'POST', signal, headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${ep.provider.name} вернул HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();

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
    `Доступные инструменты (когда нужен доступ к файлам/командам — обязательно используй их):`,
    `- web_search(ur) — прочитать любой сайт: документацию, GitHub, страницы модов, гайды.`,
    `- list_dir(root, path) — список каталога. root: portal | temp | launcher.`,
    `- read_text(root, path) — прочесть текстовый файл (до 512 КБ).`,
    `- write_text(root, path, content) — создать/перезаписать файл (спросит разрешение у пользователя).`,
    `- run_command(root, cwd, command, timeout_ms) — команда (спросит разрешение). Оболочка по умолчанию cmd, можно передать shell: 'powershell'.`,
    `- terminal(root, cwd, command) — команда в PowerShell-терминале (спросит разрешение).`,
    `- generate_image(prompt, size?) — сгенерировать изображение (спросит разрешение).`,
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
        const res = await executeTool(tc.name, tc.arguments, requestPermission, ep);
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