// Проверяет, что версия в src-tauri/Cargo.toml совпадает с тегом релиза.
//
// Проблема, которую это ловит: сборка с версией 1.2.0 и релиз с тегом v1.0.4.
// Пользователь никогда не увидит обновление, потому что 1.0.4 < 1.2.0, и
// цепочка обновлений ломается навсегда. Лучше поймать это на сборке.
//
// Использование:
//   node scripts/check-release-version.mjs            — только тег из GITHUB_REF
//   node scripts/check-release-version.mjs v1.0.4     — проверить конкретный тег
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function cargoVersion() {
  const file = path.join(root, 'src-tauri', 'Cargo.toml');
  const text = fs.readFileSync(file, 'utf8');
  // Первый version = "…" — это секция [package], а не зависимости.
  const m = /^\s*version\s*=\s*"([^"]+)"/m.exec(text);
  if (!m) {
    console.error('Не удалось прочитать version из src-tauri/Cargo.toml');
    process.exit(1);
  }
  return m[1];
}

function normalize(v) {
  return String(v).trim().replace(/^v/i, '');
}

const fromArgs = process.argv[2];
const fromEnv = (process.env.GITHUB_REF || '').startsWith('refs/tags/')
  ? process.env.GITHUB_REF.slice('refs/tags/'.length)
  : '';
const tag = fromArgs || fromEnv;

// Без тега (обычный push в main) проверять нечего — печатаем версию и выходим.
if (!tag) {
  console.log(`[version] в сборке ${cargoVersion()}, тег не задан — проверка пропущена`);
  process.exit(0);
}

const current = cargoVersion();
const wanted = normalize(tag);

if (current === wanted) {
  console.log(`[version] ${current} совпадает с тегом ${tag}`);
  process.exit(0);
}

console.error(
  `[version] РАСХОЖДЕНИЕ: в сборке ${current}, а тег релиза ${tag}.\n`
  + `Чтобы обновления доходили до пользователей, версия в сборке должна быть\n`
  + `равна тегу релиза. Поправь src-tauri/Cargo.toml -> version = "${wanted}"\n`
  + `и запушь сборку заново.`,
);
process.exit(1);
