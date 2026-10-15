/**
 * Разговор с локальным сервером официального клиента opencode.
 *
 * Прямой запрос к Zen отсекается проверкой клиента, поэтому ходим через
 * `opencode serve`: он поднимает сессию, отдаёт части ответа и сам
 * обращается к Zen уже как настоящий клиент.
 *
 * Сервер поднимается нашими же командами (opencode_proxy.rs), поэтому
 * пользователю ничего настраивать не нужно: нажал - и работает.
 */

import { invoke } from '@/lib/invoke-shim';
import type { ChatTurn, ApiOutcome, StreamDelta } from './agent';

interface ZenSession {
  id: string;
}

/** Поднимает сервер и возвращает его адрес. Бросает с понятной причиной. */
export async function ensureZenProxy(): Promise<string> {
  const status = await invoke<{ running: boolean; base_url: string | null; installed: boolean }>(
    'zen_proxy_status'
  );
  if (status.running && status.base_url) return status.base_url;

  if (!status.installed) {
    throw new Error(
      'Официальный клиент opencode не установлен. Установите его один раз командой ' +
        '`npm install -g opencode-ai` — дальше всё поднимется само.'
    );
  }
  return await invoke<string>('zen_proxy_start', { port: null });
}

let sessionCache: { key: string; id: string } | null = null;

/** Сессия переиспользуется, пока не сменился провайдер с моделью. */
async function getSession(base: string, modelKey: string): Promise<ZenSession> {
  if (sessionCache && sessionCache.key === modelKey) {
    return { id: sessionCache.id };
  }
  const res = await fetch(`${base}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error(`opencode не дал создать сессию: HTTP ${res.status}`);
  }
  const session = (await res.json()) as ZenSession;
  sessionCache = { key: modelKey, id: session.id };
  return session;
}

/** Сбрасывает кэш сессии - например, при смене чата или провайдера. */
export function resetZenSession() {
  sessionCache = null;
}

/**
 * Отправляет сообщение и разбирает поток событий в дельты для чата.
 * Возвращает накопленный текст ответа.
 */
export async function callViaOpencode(
  ep: { providerId: string; modelId: string; apiKey?: string },
  systemPrompt: string,
  turns: ChatTurn[],
  onDelta?: (d: StreamDelta) => void,
  signal?: AbortSignal,
): Promise<ApiOutcome> {
  const base = await ensureZenProxy();
  const apiKey = ep.apiKey?.trim();
  if (apiKey) {
    const auth = await fetch(`${base}/auth/${encodeURIComponent(ep.providerId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'api', key: apiKey }),
    });
    if (!auth.ok) {
      throw new Error(`opencode не принял ключ провайдера (HTTP ${auth.status}). Проверь API-ключ в «Управление моделями».`);
    }
  }
  const session = await getSession(base, `${ep.providerId}/${ep.modelId}`);

  const parts = turns.map(turn => ({
    type: 'text' as const,
    text: turn.role === 'user' ? turn.content : `[ответ ассистента] ${turn.content}`,
  }));

  // Сначала подписываемся на события: ответ начинает приходить сразу после
  // prompt_async, и если подписаться позже, можно пропустить начало.
  const events = new AbortController();
  const onAbort = () => events.abort();
  signal?.addEventListener('abort', onAbort);

  const seen = new Map<string, string>();
  let output = '';
  let thinking = '';
  let failure: string | undefined;

  const streamDone = (async () => {
    try {
      const res = await fetch(`${base}/event`, { signal: events.signal });
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split = buffer.indexOf('\n\n');
        while (split >= 0) {
          const chunk = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          split = buffer.indexOf('\n\n');
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data:')) continue;
            let payload: any;
            try { payload = JSON.parse(line.slice(5).trim()); } catch { continue; }
            const type = payload?.type;
            if (type === 'message.part.updated') {
              const part = payload.properties?.part;
              if (!part || part.sessionID !== session.id) continue;
              if (part.type === 'text' && typeof part.text === 'string') {
                const previous = seen.get(part.id ?? '') ?? '';
                if (part.text.startsWith(previous)) {
                  const fresh = part.text.slice(previous.length);
                  output += fresh;
                  onDelta?.({ content: fresh });
                } else {
                  output = part.text;
                  onDelta?.({ content: part.text });
                }
                seen.set(part.id ?? String(output.length), part.text);
              } else if (part.type === 'reasoning' && typeof part.text === 'string') {
                const previous = seen.get(part.id ?? '') ?? '';
                if (part.text.startsWith(previous)) {
                  const fresh = part.text.slice(previous.length);
                  thinking += fresh;
                  onDelta?.({ thinking: fresh });
                }
                seen.set(part.id ?? String(thinking.length), part.text);
              } else if (part.type === 'tool') {
                if (part.type === 'tool' && part.state?.status === 'running') { onDelta?.({ thinking: '' }); }
              }
            } else if (type === 'session.error' || type === 'message.error') {
              failure = payload?.properties?.error?.name ?? 'opencode вернул ошибку';
            }
          }
        }
      }
    } catch {
      // обрыв потока - это нормально, когда его закрыли по сигналу
    }
  })();

  try {
    const res = await fetch(`${base}/session/${session.id}/prompt_async`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: { providerID: ep.providerId, modelID: ep.modelId },
        system: systemPrompt,
        parts,
      }),
      signal,
    });
if (!res.ok) {
      events.abort();
      const body = await res.text().catch(() => '');
      throw new Error(`opencode отклонил запрос (HTTP ${res.status}). ${body.slice(0, 200)}`);
    }
  } catch (error: any) {
    events.abort();
    if (signal?.aborted) return { text: output, thinking: thinking || undefined, raw: null };
    throw new Error(`Не удалось отправить сообщение: ${String(error?.message || error)}`);
  }

  await streamDone;
  signal?.removeEventListener('abort', onAbort);

  if (failure && !output) throw new Error(failure);
  return { text: output || thinking, thinking: thinking || undefined, raw: null };
}
