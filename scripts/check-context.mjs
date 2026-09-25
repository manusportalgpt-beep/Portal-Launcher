// Проверка: какой размер контекста лаунчер посчитает для моделей Zen,
// которые не сообщают context_length.
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  configFile: false, root, server: { middlewareMode: true }, appType: 'custom',
  resolve: { alias: { '@': path.join(root, 'src') } },
});

try {
  const { contextWindow } = await server.ssrLoadModule('/src/lib/opencore/providers.ts');

  // Именно те поля, которые реально отдаёт opencode.ai/zen/v1/models.
  const zenModels = [
    'space-bunny-free', 'big-pickle', 'jev-1.13-free', 'deepseek-v4-flash-free',
    'muse-spark-1.3-contributor-free', 'muse-spark-1.2-contributor-free',
    'mimo-v2.6-flash-free', 'mimo-v2.5-free', 'ling-3.0-flash-fin-free',
    'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free',
  ];

  console.log('модель'.padEnd(38), 'контекст'.padStart(12), ' человекочитаемо');
  for (const id of zenModels) {
    const model = { id };
    const value = contextWindow(model, 'opencode-zen');
    const human = value >= 1_000_000 ? `${value.toLocaleString('ru-RU')} (1M+)` : value.toLocaleString('ru-RU');
    console.log(id.padEnd(38), String(value).padStart(12), ' ' + human);
  }

  console.log('\nпроверка приоритетов для space-bunny-free:');
  const base = { id: 'space-bunny-free' };
  console.log('  только id (как от Zen)          ->', contextWindow(base, 'opencode-zen').toLocaleString('ru-RU'));
  console.log('  с contextLength из API          ->', contextWindow({ ...base, contextLength: 1_048_576 }, 'opencode-zen').toLocaleString('ru-RU'));
  console.log('  ручное переопределение 2M        ->', contextWindow({ ...base, contextLength: 2_000_000 }, 'opencode-zen').toLocaleString('ru-RU'));
} finally {
  await server.close();
}
