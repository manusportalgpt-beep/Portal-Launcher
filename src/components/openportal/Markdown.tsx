import { memo, useEffect, useState, type ReactNode } from 'react';
import { invoke } from '@/lib/invoke-shim';

/** Кеш data-URL изображений, чтобы не перечитывать файл на каждый рендер. */
const imageCache = new Map<string, Promise<string> | string>();

function loadImage(name: string): Promise<string> {
  const hit = imageCache.get(name);
  if (hit) return Promise.resolve(hit);
  const p = invoke<string>('op_image_read', { file: name })
    .then(dataUrl => { imageCache.set(name, dataUrl); return dataUrl; })
    .catch(e => { imageCache.delete(name); throw e; });
  imageCache.set(name, p);
  return p;
}

/** Встраивает изображение из кеша OpenPortal (`/op-image/<name>`). */
function PortalImage({ name }: { name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    let alive = true;
    loadImage(name)
      .then(dataUrl => { if (alive) setSrc(dataUrl); })
      .catch(e => { if (alive) setErr(String(e)); });
    return () => { alive = false; };
  }, [name]);

  const copy = async () => {
    const dataUrl = src ?? '';
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
    } catch {
      await navigator.clipboard.writeText(dataUrl);
    }
    setMenu(false);
  };

  const download = () => {
    const a = document.createElement('a');
    a.href = src ?? '';
    a.download = name;
    a.click();
    setMenu(false);
  };

  if (err) return <span className="text-[12px] italic" style={{ color: 'var(--color-error)' }}>Не удалось загрузить картинку: {err}</span>;

  return (
    <span className="not-prose relative inline-block">
      {src
        ? <img
            src={src}
            alt={name}
            className="max-h-96 rounded-xl border object-contain"
            style={{ borderColor: 'var(--color-border)' }}
            onContextMenu={e => { e.preventDefault(); setMenu(m => !m); }}
          />
        : <span className="inline-block h-24 w-36 rounded-xl animate-pulse" style={{ background: 'var(--color-surface-2)' }} />}
      {menu && (
        <>
          <span className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
          <span
            className="absolute left-0 top-full z-50 mt-1 flex flex-col rounded-xl border p-1"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 12px 32px rgba(0,0,0,.35)' }}
            onClick={() => setMenu(false)}>
            <button onClick={copy} className="rounded-lg px-3 py-1.5 text-left text-[12px] font-semibold hover:bg-[var(--color-surface-2)]" style={{ color: 'var(--color-text)' }}>Копировать</button>
            <button onClick={download} className="rounded-lg px-3 py-1.5 text-left text-[12px] font-semibold hover:bg-[var(--color-surface-2)]" style={{ color: 'var(--color-text)' }}>Скачать</button>
          </span>
        </>
      )}
    </span>
  );
}

/** Минимальный markdown-рендерер без зависимостей. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;

  // Сначала — изображения: `![подпись](/op-image/<name>)`
  const imgRe = /!\[[^\]]*\]\((\/op-image\/[^)]+)\)/g;
  imgRe.lastIndex = 0;
  let im: RegExpExecArray | null;
  let key = 0;
  const parts: ReactNode[] = [];
  let anchor = 0;
  const find = () => imgRe.exec(text);
  while ((im = find()) !== null) {
    const name = im[1].replace(/^\/op-image\//, '').split('?')[0];
    if (!/^[\w-]+\.png$/.test(name)) continue;
    if (im.index > anchor) parts.push(<span key={`t${key++}`}>{text.slice(anchor, im.index)}</span>);
    parts.push(<PortalImage key={`i${key++}`} name={name} />);
    anchor = im.index + im[0].length;
  }
  if (anchor > 0) {
    if (anchor < text.length) parts.push(<span key={`t${key++}`}>{text.slice(anchor)}</span>);
    return parts;
  }

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