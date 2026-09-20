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

/** Встраивает изображение из кеша OpenPortal (`/op-image/<name>`). Клик — просмотр на весь экран. */
export function PortalImage({ name }: { name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    loadImage(name)
      .then(dataUrl => { if (alive) setSrc(dataUrl); })
      .catch(e => { if (alive) setErr(String(e)); });
    return () => { alive = false; };
  }, [name]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const copy = async () => {
    const dataUrl = src ?? '';
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
    } catch {
      await navigator.clipboard.writeText(dataUrl);
    }
  };

  const download = () => {
    const a = document.createElement('a');
    a.href = src ?? '';
    a.download = name;
    a.click();
  };

  if (err) return <span className="text-[12px] italic" style={{ color: 'var(--color-error)' }}>Не удалось загрузить картинку: {err}</span>;

  return (
    <span className="not-prose relative inline-block">
      {src
        ? <img
            src={src}
            alt={name}
            className="max-h-96 max-w-full cursor-zoom-in rounded-xl border object-contain"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => setOpen(true)}
          />
        : <span className="inline-block h-24 w-36 rounded-xl animate-pulse" style={{ background: 'var(--color-surface-2)' }} />}
      {open && src && (
        <span
          className="fixed inset-0 z-[70] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={() => setOpen(false)}>
          <span className="flex max-h-full max-w-full flex-col gap-2" onClick={e => e.stopPropagation()}>
            <img src={src} alt={name} className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.6)' }} />
            <span className="flex items-center justify-center gap-1.5">
              <button onClick={() => void copy()} className="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-white/10"
                style={{ color: 'var(--color-text)', background: 'rgba(127,127,127,0.25)' }}>Копировать</button>
              <button onClick={download} className="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-white/10"
                style={{ color: 'var(--color-text)', background: 'rgba(127,127,127,0.25)' }}>Скачать</button>
              <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-white/10"
                style={{ color: 'var(--color-text)', background: 'rgba(127,127,127,0.25)' }}>Закрыть ✕</button>
            </span>
          </span>
        </span>
      )}
    </span>
  );
}

/** Карточка артефакта: файл агента в песочнице, который можно скачать в «Загрузки». */
function PortalArtifact({ path, name }: { path: string; name: string }) {
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [err, setErr] = useState('');
  const save = async () => {
    if (state === 'saving') return;
    setState('saving');
    setErr('');
    try {
      await invoke('op_copy_to_downloads', { root: 'portal', path, name });
      setState('done');
      setTimeout(() => setState('idle'), 1800);
    } catch (e) {
      setState('error');
      setErr(String(e));
    }
  };
  return (
    <div className="op-fade-in my-2 flex items-center gap-2 rounded-lg px-3 py-2"
      style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(127,127,127,0.2)' }}>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold" style={{ color: 'var(--color-text)' }}>{name}</span>
        <span className="block truncate text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{path}</span>
      </div>
      <button onClick={() => void save()} disabled={state === 'saving'}
        className="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors hover:opacity-85 disabled:opacity-60"
        style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
        {state === 'done' ? 'Готово' : state === 'saving' ? 'Копирую…' : 'Скачать'}
      </button>
      {state === 'error' && (
        <span className="shrink-0 text-[11px]" style={{ color: 'var(--color-error)' }} title={err}>Ошибка</span>
      )}
    </div>
  );
}

/** Карточка-превью ссылки: скриншот страницы через WordPress mShots (без ключей) + домен. */
function LinkPreview({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const clean = url.split(/[\s<>'"`{}]|\)$/)[0].replace(/[.,;!?]+$/, '');
  let host = '';
  let target = clean;
  try {
    const u = new URL(clean);
    host = u.host.replace(/^www\./, '');
    target = u.href;
  } catch {
    return null;
  }
  if (!host || failed) return null;
  const shot = `https://s.wordpress.com/mshots/v1/${encodeURIComponent(target)}?w=360&h=190`;
  return (
    <a href={target} target="_blank" rel="noreferrer"
      className="mt-1.5 block w-full max-w-[300px] overflow-hidden rounded-xl border transition-transform hover:-translate-y-0.5"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <span className="flex h-28 w-full items-center justify-center overflow-hidden bg-black/20">
        <img src={shot} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover"
          onError={() => setFailed(true)} />
      </span>
      <span className="block px-2.5 py-1.5">
        <span className="block truncate text-[10.5px] font-bold" style={{ color: 'var(--color-text)' }}>{host}</span>
      </span>
    </a>
  );
}

/** Минимальный markdown-рендерер без зависимостей. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~|!?\[[^\]]*\]\([^)]+\))/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  // Токен `/op-image/<name>` в обычном тексте тоже превращаем в картинку.
  const pushText = (seg: string) => {
    const re2 = /\/op-image\/([A-Za-z0-9-]+\.(?:png|jpg|jpeg|webp|gif))/g;
    let p = 0;
    let mm: RegExpExecArray | null;
    while ((mm = re2.exec(seg)) !== null) {
      if (mm.index > p) nodes.push(seg.slice(p, mm.index));
      nodes.push(<PortalImage key={key++} name={mm[1]} />);
      p = mm.index + mm[0].length;
    }
    if (p < seg.length) nodes.push(seg.slice(p));
  };
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) pushText(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      nodes.push(
        <code key={key++} className="rounded-[4px] px-1 py-0.5 text-[0.92em] font-mono"
          style={{ background: 'rgba(122,162,247,0.14)', color: '#7aa2f7' }}>
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      nodes.push(<strong key={key++} className="font-bold">{renderInline(tok.slice(2, -2))}</strong>);
    } else if (tok.startsWith('*') || tok.startsWith('_')) {
      nodes.push(<em key={key++}>{renderInline(tok.slice(1, -1))}</em>);
    } else if (tok.startsWith('~~')) {
      nodes.push(<s key={key++} className="opacity-70">{renderInline(tok.slice(2, -2))}</s>);
    } else {
      const inner = /^(!?)\[([^\]]*)\]\(([^)]+)\)$/.exec(tok);
      if (inner) {
        const isImage = inner[1] === '!';
        const href = inner[3];
        if (isImage && href.startsWith('/op-image/')) {
          const name = href.replace(/^\/op-image\//, '').split('?')[0];
          if (/^[\w-]+\.(png|jpg|jpeg|webp|gif)$/.test(name)) nodes.push(<PortalImage key={key++} name={name} />);
          else nodes.push(tok);
        } else if (isImage && /https?:\/\//i.test(href)) {
          nodes.push(
            <img key={key++} src={href} alt={inner[2] || ''} loading="lazy" referrerPolicy="no-referrer"
              className="max-h-96 rounded-xl border object-contain"
              style={{ borderColor: 'var(--color-border)' }}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />,
          );
        } else {
          nodes.push(
            <a key={key++} href={href} target="_blank" rel="noreferrer"
              className="underline underline-offset-2 hover:opacity-80"
              style={{ color: 'var(--color-primary)' }}>
              {inner[2] || href}
            </a>,
          );
        }
      } else {
        nodes.push(tok);
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) pushText(text.slice(last));
  return nodes;
}

// ---------------------------------------------------------------------------
// Подсветка кода без внешних зависимостей
// ---------------------------------------------------------------------------

const KEYWORDS = new Set([
  'const','let','var','function','return','if','else','for','while','do','in','of','from','import','export','default',
  'interface','type','class','extends','new','async','await','null','undefined','true','false','switch','case','break',
  'continue','throw','try','catch','finally','typeof','instanceof','pub','fn','mut','use','struct','enum','impl','trait',
  'match','mod','unsafe','static','def','abstract','private','public','protected','readonly','yield','super','this','as',
  'void','never','number','string','boolean','object','any','unknown','get','set','and','or','not','lambda',
]);

const TOKEN_RE =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b/g;

function tokenizeInline(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const tok = m[0];
    let color: string | undefined;
    let italic = false;
    if (tok.startsWith('//') || tok.startsWith('/*')) { color = '#7982a9'; italic = true; }
    else if (tok.startsWith('"') || tok.startsWith("'") || tok.startsWith('`')) color = '#9ece6a';
    else if (/^\d/.test(tok)) color = '#ff9e64';
    else if (KEYWORDS.has(tok)) color = '#82aaff';
    if (color) out.push(<span key={key++} style={{ color, fontStyle: italic ? 'italic' : undefined }}>{tok}</span>);
    else out.push(tok);
    last = m.index + tok.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

function CodeCopy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch { /* clipboard может быть недоступен */ }
      }}
      className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors hover:opacity-80"
      style={{ color: 'var(--color-text-secondary)', background: 'rgba(127,127,127,0.15)' }}>
      {copied ? 'Скопировано' : 'Копировать'}
    </button>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  return (
    <div className="my-2 overflow-hidden rounded-lg text-left"
      style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(127,127,127,0.2)' }}>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5"
        style={{ borderColor: 'rgba(127,127,127,0.2)' }}>
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
          {lang || 'text'}
        </span>
        <CodeCopy text={code} />
      </div>
      <pre className="overflow-x-auto p-3 text-[12px] leading-5 font-mono" style={{ color: 'var(--color-text)' }}>
        {code.split('\n').map((ln, i) => (
          <span key={i} className="block">{tokenizeInline(ln)}</span>
        ))}
      </pre>
    </div>
  );
}

function CodeTabs({ blocks }: { blocks: { code: string; lang: string }[] }) {
  const [active, setActive] = useState(0);
  if (blocks.length === 1) return <CodeBlock code={blocks[0].code} lang={blocks[0].lang} />;
  const shown = active < blocks.length ? blocks[active] : blocks[0];
  return (
    <div className="my-2 text-left">
      <div className="flex flex-wrap gap-1">
        {blocks.map((b, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            className="rounded-t-md px-3 py-1 text-[11px] font-semibold transition-colors"
            style={i === active
              ? { color: 'var(--color-text)', background: 'rgba(127,127,127,0.2)', border: '1px solid rgba(127,127,127,0.2)', borderBottom: 'none' }
              : { color: 'var(--color-text-secondary)', background: 'transparent', border: '1px solid transparent', borderBottom: 'none' }}>
            {b.lang || `блок ${i + 1}`}
          </button>
        ))}
      </div>
      <CodeBlock code={shown.code} lang={shown.lang} />
    </div>
  );
}

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const blocks = text.split(/\r?\n/);
  const out: ReactNode[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let fenceLang = '';
  let pendingCode: { code: string; lang: string }[] = [];
  let prevClosedFence = false;
  let listBuf: React.ReactNode[] = [];
  let listOrdered = false;
  let quoteBuf: ReactNode[] = [];
  let key = 0;

  const flushList = () => {
    if (listBuf.length === 0) return;
    const Tag = listOrdered ? 'ol' : 'ul';
    out.push(
      <Tag key={key++} className={`op-fade-in my-1 space-y-0.5 pl-5 ${listOrdered ? 'list-decimal' : 'list-disc'}`}>
        {listBuf}
      </Tag>,
    );
    listBuf = [];
  };

  const flushQuote = () => {
    if (quoteBuf.length === 0) return;
    out.push(
      <blockquote key={key++} className="op-fade-in my-1 border-l-2 pl-3 text-[12.5px] italic"
        style={{ borderColor: 'var(--color-primary)', color: 'var(--color-text-secondary)' }}>
        {quoteBuf}
      </blockquote>,
    );
    quoteBuf = [];
  };

  const flushCode = () => {
    if (pendingCode.length === 0) return;
    out.push(<div key={key++} className="op-fade-in"><CodeTabs blocks={pendingCode} /></div>);
    pendingCode = [];
  };

  const flushAll = () => {
    flushCode();
    flushQuote();
    flushList();
  };

  for (const raw of blocks) {
    const line = raw;

    if (line.startsWith('```')) {
      if (inCode) {
        pendingCode.push({ code: codeLines.join('\n'), lang: fenceLang });
        codeLines = [];
        inCode = false;
        prevClosedFence = true;
      } else {
        if (!prevClosedFence) flushAll();
        prevClosedFence = false;
        fenceLang = line.replace(/^```/, '').trim().split(/\s+/)[0] ?? '';
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    prevClosedFence = false;

    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flushCode();
      flushQuote();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      if (listBuf.length > 0 && ordered !== listOrdered) flushList();
      listOrdered = ordered;
      listBuf.push(<li key={key++}>{renderInline(line.replace(/^\s*([-*+]|\d+[.)])\s+/, ''))}</li>);
      continue;
    }
    flushList();

    if (/^>\s?/.test(line)) {
      flushCode();
      quoteBuf.push(<p key={key++} className="my-0.5">{renderInline(line.replace(/^>\s?/, ''))}</p>);
      continue;
    }
    flushQuote();
    flushCode();

    const artifact = /^\/op-project\s+(\S+)(?:\|(.*))?$/.exec(line.trim());
    if (artifact) {
      out.push(
        <div key={key++} className="op-fade-in">
          <PortalArtifact path={artifact[1]} name={artifact[2]?.trim() || artifact[1].split('/').pop() || artifact[1]} />
        </div>,
      );
    } else if (/^(---+|\*\*\*+|___+)$/.test(line.trim())) {
      out.push(<hr key={key++} className="op-fade-in my-2 border-t" style={{ borderColor: 'rgba(127,127,127,0.25)' }} />);
    } else if (/^#{1,4}\s/.test(line)) {
      const level = line.match(/^#+/)?.[0].length ?? 1;
      const txt = line.replace(/^#+\s+/, '');
      const Tag = level <= 2 ? 'h3' : 'h4';
      out.push(
        <Tag key={key++} className={`op-fade-in ${level <= 2 ? 'mt-2 text-sm font-bold' : 'mt-1.5 text-[13px] font-bold'}`}>
          {renderInline(txt)}
        </Tag>,
      );
    } else if (line.trim() === '') {
      out.push(<div key={key++} className="h-1.5" />);
    } else {
      const nodes: ReactNode[] = [<span key={key++}>{renderInline(line)}</span>];
      const seen = new Set<string>();
      let m2: RegExpExecArray | null;
      const urlRe = /https?:\/\/[^\s<>()\[\]`"']+/gi;
      urlRe.lastIndex = 0;
      while ((m2 = urlRe.exec(line)) !== null && seen.size < 2) {
        const url = m2[0].replace(/[.,;!?)]+$/, '');
        if (!/\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(url) && !seen.has(url)) {
          seen.add(url);
          nodes.push(<LinkPreview key={key++} url={url} />);
        }
      }
      out.push(<p key={key++} className="op-fade-in break-words whitespace-pre-wrap">{nodes}</p>);
    }
  }
  flushAll();
  if (inCode && codeLines.length) pendingCode.push({ code: codeLines.join('\n'), lang: fenceLang });
  flushCode();
  return <div className="text-[13px] leading-6">{out}</div>;
});