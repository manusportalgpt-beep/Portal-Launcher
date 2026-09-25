/**
 * Построчный diff для показа изменений файлов в чате агента.
 *
 * Используется динамическое программирование (LCS) по строкам. Файлы модов и
 * конфигов обычно небольшие, поэтому полная таблица LCS безопасна; для очень
 * больших файлов вызывающий код ограничивает размер.
 */

export type DiffKind = 'context' | 'add' | 'remove';

export interface DiffLine {
  kind: DiffKind;
  /** Номер строки в файле «до» (для remove/context) либо null. */
  before: number | null;
  /** Номер строки в файле «после» (для add/context) либо null. */
  after: number | null;
  text: string;
}

export interface LineDiff {
  added: number;
  removed: number;
  lines: DiffLine[];
}

const MAX_LINES = 4000;

/** Сравнивает два текста построчно. */
export function diffLines(before: string, after: string): LineDiff {
  const a = before.length ? before.split('\n') : [];
  const b = after.length ? after.split('\n') : [];
  const n = Math.min(a.length, MAX_LINES);
  const m = Math.min(b.length, MAX_LINES);

  // LCS: таблица (n+1) x (m+1).
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'context', before: i + 1, after: j + 1, text: a[i] });
      i++; j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ kind: 'remove', before: i + 1, after: null, text: a[i] });
      i++;
    } else {
      lines.push({ kind: 'add', before: null, after: j + 1, text: b[j] });
      j++;
    }
  }
  while (i < n) { lines.push({ kind: 'remove', before: i + 1, after: null, text: a[i] }); i++; }
  while (j < m) { lines.push({ kind: 'add', before: null, after: j + 1, text: b[j] }); j++; }

  // Хвост за пределами лимита отмечаем как добавленные/удалённые.
  for (let k = n; k < a.length; k++) lines.push({ kind: 'remove', before: k + 1, after: null, text: a[k] });
  for (let k = m; k < b.length; k++) lines.push({ kind: 'add', before: null, after: k + 1, text: b[k] });

  return {
    added: lines.filter(l => l.kind === 'add').length,
    removed: lines.filter(l => l.kind === 'remove').length,
    lines,
  };
}

/** Короткая сводка изменений: «+12 −3». */
export function diffSummary(diff: LineDiff): string {
  return `+${diff.added} −${diff.removed}`;
}
