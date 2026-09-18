import { memo, type ReactNode } from 'react';

/** Минимальный markdown-рендерер без зависимостей. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      nodes.push(<strong key={key++} className="font-bold">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('`')) {
      nodes.push(
        <code key={key++} className="rounded-[4px] px-1 py-0.5 text-[0.92em] font-mono"
          style={{ background: 'rgba(127,127,127,0.18)', color: 'var(--color-text)' }}>
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      const inner = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      if (inner) {
        nodes.push(
          <a key={key++} href={inner[2]} target="_blank" rel="noreferrer"
            className="underline underline-offset-2 hover:opacity-80"
            style={{ color: 'var(--color-primary)' }}>
            {inner[1]}
          </a>,
        );
      } else {
        nodes.push(tok);
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\r?\n/);
  const out: ReactNode[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let listBuf: React.ReactNode[] = [];
  let key = 0;

  const flushList = () => {
    if (listBuf.length === 0) return;
    out.push(
      <ul key={key++} className="my-1 list-disc space-y-0.5 pl-5">
        {listBuf}
      </ul>,
    );
    listBuf = [];
  };

  for (const raw of blocks) {
    const line = raw;

    if (line.startsWith('```')) {
      if (inCode) {
        out.push(
          <pre key={key++} className="my-2 rounded-lg p-3 text-[12px] leading-5 font-mono overflow-x-auto"
            style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(127,127,127,0.2)' }}>
            {codeLines.join('\n')}
          </pre>,
        );
        codeLines = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    if (/^\s*[-*]\s+/.test(line)) {
      listBuf.push(<li key={key++}>{renderInline(line.replace(/^\s*[-*]\s+/, ''))}</li>);
      continue;
    }
    flushList();

    if (/^#{1,4}\s/.test(line)) {
      const level = line.match(/^#+/)?.[0].length ?? 1;
      const txt = line.replace(/^#+\s+/, '');
      const Tag = level <= 2 ? 'h3' : 'h4';
      out.push(
        <Tag key={key++} className={level <= 2 ? 'mt-2 text-sm font-bold' : 'mt-1.5 text-[13px] font-bold'}>
          {renderInline(txt)}
        </Tag>,
      );
    } else if (line.trim() === '') {
      out.push(<div key={key++} className="h-1.5" />);
    } else {
      out.push(
        <p key={key++} className="break-words whitespace-pre-wrap">{renderInline(line)}</p>,
      );
    }
  }
  flushList();
  if (inCode && codeLines.length) {
    out.push(
      <pre key={key++} className="my-2 rounded-lg p-3 text-[12px] leading-5 font-mono overflow-x-auto"
        style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(127,127,127,0.2)' }}>
        {codeLines.join('\n')}
      </pre>,
    );
  }
  return <div className="text-[13px] leading-6">{out}</div>;
});