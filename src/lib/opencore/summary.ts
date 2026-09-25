import type { ChatMessage } from '@/lib/opencore/types';

/**
 * Локальная выжимка истории без обращения к модели.
 *
 * Нужна при смене модели: раньше контекст новой модели был пустым, и чат
 * выглядел как только что созданный. Теперь вместо пустоты в новый контекст
 * кладётся компактная выжимка (summary: true) — агент её видит, но она не
 * засчитывается в расход контекста и в списке обычных реплик не светится.
 *
 * Отдельный модуль, а не функция в agent.ts: agent.ts импортирует стор, и
 * импорт в обратную сторону создал бы циклическую зависимость.
 */
const MAX_PART = 700;
const MAX_TOTAL = 16_000;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function buildLocalSummary(messages: ChatMessage[]): ChatMessage | null {
  const useful = messages.filter(m => m.role === 'user' || (m.role === 'assistant' && m.content.trim()));
  if (useful.length === 0) return null;

  const lines: string[] = [];
  let budget = MAX_TOTAL;
  for (const m of useful) {
    const label = m.role === 'user' ? 'Пользователь' : 'Агент';
    const line = `- ${label}: ${clip(m.content, MAX_PART)}`;
    if (line.length > budget) break;
    budget -= line.length;
    lines.push(line);
  }
  if (lines.length === 0) return null;

  return {
    id: `summary-model-switch-${Date.now()}`,
    role: 'assistant',
    content:
      `**Выжимка предыдущей работы** (${useful.length} сообщений, сжато при смене модели)\n\n` +
      `${lines.join('\n')}`,
    timestamp: Date.now(),
    summary: true,
  };
}
