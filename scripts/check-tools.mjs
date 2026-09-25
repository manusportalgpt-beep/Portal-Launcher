// Проверка схем инструментов через vite: ищем то, что провайдеры отклоняют с HTTP 400.
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const server = await createServer({
  configFile: false,
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  resolve: { alias: { '@': path.join(root, 'src') } },
});

try {
  const mod = await server.ssrLoadModule('/src/lib/opencore/agent.ts');
  const TOOLS = mod.TOOLS;
  const problems = [];
  const names = new Set();

  for (const t of TOOLS) {
    if (names.has(t.name)) problems.push(`дубликат имени: ${t.name}`);
    names.add(t.name);
    if (!t.description || !String(t.description).trim()) problems.push(`${t.name}: нет description`);
    const p = t.parameters;
    if (!p) { problems.push(`${t.name}: нет parameters`); continue; }
    if (p.type !== 'object') problems.push(`${t.name}: parameters.type=${p.type}`);
    if (!p.properties || typeof p.properties !== 'object') problems.push(`${t.name}: нет properties`);
    for (const [key, schema] of Object.entries(p.properties ?? {})) {
      if (!schema || typeof schema !== 'object') { problems.push(`${t.name}.${key}: не объект`); continue; }
      if (!schema.type) problems.push(`${t.name}.${key}: нет type`);
      if (schema.type === 'array' && !schema.items) problems.push(`${t.name}.${key}: array без items`);
      if (Array.isArray(schema.enum) && schema.enum.length === 0) problems.push(`${t.name}.${key}: пустой enum`);
    }
    for (const req of p.required ?? []) {
      if (!(req in (p.properties ?? {}))) problems.push(`${t.name}: required "${req}" нет в properties`);
    }
  }

  console.log(`Инструментов: ${TOOLS.length}`);
  console.log(`Всего параметров: ${TOOLS.reduce((n, t) => n + Object.keys(t.parameters?.properties ?? {}).length, 0)}`);
  console.log(`Всего символов в описаниях: ${TOOLS.reduce((n, t) => n + t.description.length, 0)}`);
  console.log(problems.length ? `\nПРОБЛЕМЫ (${problems.length}):` : '\nСхемы корректны.');
  for (const x of problems) console.log(' - ' + x);

  const longest = TOOLS.map(t => ({ name: t.name, len: t.description.length })).sort((a, b) => b.len - a.len).slice(0, 6);
  console.log('\nСамые длинные описания:');
  for (const x of longest) console.log(` - ${x.name}: ${x.len}`);
} finally {
  await server.close();
}
