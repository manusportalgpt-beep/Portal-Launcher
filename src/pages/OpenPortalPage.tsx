import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, MessageSquare, Trash2, Sparkles, Send, StopCircle, ChevronDown, ChevronRight,
  Settings2, Bot, Hammer, DraftingCompass, Braces, ChevronLeft, Boxes, Check, Copy, Download,
  Gauge, Minimize2, CornerDownRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@/lib/invoke-shim';
import { useOpenCoreStore, activeProviders, isProviderEnabled, isModelEnabled, firstConnectedProvider } from '@/stores/opencoreStore';
import { useInstanceStore } from '@/stores/instanceStore';
import { useCurrentUser } from '@/stores/authStore';
import { toIconSrc } from '@/lib/icon-src';
import { resolveEndpoint, runAgentTurn, buildSystemPrompt, compressHistory, callProvider } from '@/lib/opencore/agent';
import { Markdown } from '@/components/openportal/Markdown';
import { ModelManager } from '@/components/openportal/ModelManager';
import { PermissionModal } from '@/components/openportal/PermissionModal';
import type { ChatMessage, SessionData, PermissionRequest, Attachment, ProjectContext } from '@/lib/opencore/types';

const HELP_TEXT = [
  '**Команды OpenPortal:**',
  '- `/help` — список команд и инструментов',
  '- `/models` — выбрать модели и ключи',
  '- `/new` — новый чат',
  '- `/clear` — очистить чат',
  '- `/compress` — сжать историю (краткая выжимка вместо старых сообщений)',
  '- `/context` — показать расход контекста и токенов',
  '- `/plan` — режим Plan (только план)',
  '- `/build` — режим Build (выполняет задачи)',
  '- `/skill-creator <описание>` — агент создаст новый навык',
  '- `/skill-installer <имя/ссылка>` — агент найдёт и установит навык',
  '- `/cache` — размер кеша зависимостей песочницы, `/cache clean` — очистить его',
  '',
  '**Инструменты агента** (агент использует их сам, по ходу задачи): веб-поиск и чтение страниц, ' +
  'HTTP-запросы к API, файлы (чтение/запись), команды (cmd/PowerShell), параллельные субагенты, генерация картинок.',
  '',
  'Файлы прикрепляются кнопкой «+» у поля ввода и сохраняются кнопкой «Скачать» в «Загрузки».',
  '',
  '**Фоновые задачи:** можно запустить агента в одном чате и переключиться в другой — задачи выполняются параллельно, слева у активных чатов крутится индикатор.',
].join('\n');

/** Палитра команд «/» в стиле opencode. instant — выполняется сразу, иначе вставляется в поле для продолжения. */
const COMMANDS: { cmd: string; desc: string; instant: boolean }[] = [
  { cmd: '/help', desc: 'Список команд и инструментов', instant: true },
  { cmd: '/models', desc: 'Выбрать модели и ключи', instant: true },
  { cmd: '/new', desc: 'Новый чат', instant: true },
  { cmd: '/clear', desc: 'Очистить сообщения', instant: true },
  { cmd: '/compress', desc: 'Сжать историю в краткую выжимку', instant: true },
  { cmd: '/context', desc: 'Расход контекста и токенов', instant: true },
  { cmd: '/plan', desc: 'Режим Plan — только план', instant: true },
  { cmd: '/build', desc: 'Режим Build — выполнять задачи', instant: true },
  { cmd: '/skill-creator', desc: 'Создать новый навык', instant: false },
  { cmd: '/skill-installer', desc: 'Найти и установить навык', instant: false },
  { cmd: '/cache', desc: 'Кеш зависимостей песочницы (/cache clean — очистить)', instant: true },
];

/** Расширение файла из имени (в верхнем регистре, для бейджа). */
function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toUpperCase() : 'FILE';
}

/** Человекочитаемый размер. */
function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Копирование в буфер обмена (clipboard API + фолбэк для вебвью). */
async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(ta);
  }
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2 overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-2)' }}>
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
        <Braces size={12} /> Внутренние рассуждения (Thinking)
        <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      <AnimatePresence>
      {open && (
        <motion.pre initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          className="max-h-64 overflow-y-auto px-3 pb-3 text-[11.5px] leading-5 whitespace-pre-wrap font-mono"
          style={{ color: 'var(--color-text-secondary)' }}>
          {text}
        </motion.pre>
      )}
      </AnimatePresence>
    </div>
  );
}

function ToolMsg({ name, content, error }: { name: string; content: string; error?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ore-plain mb-1.5 overflow-hidden rounded-lg border px-2.5 py-1.5" style={{ borderColor: 'var(--color-border)', background: 'rgba(127,127,127,0.08)' }}>
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 text-left text-[11px] font-semibold"
        style={{ color: error ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
        <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        {name}
        <span className="ml-auto font-normal" style={{ color: 'var(--color-text-tertiary)' }}>{error ? 'ошибка' : 'ок'}</span>
      </button>
      <AnimatePresence>
      {open && (
        <motion.pre initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          className="max-h-72 overflow-y-auto pt-1.5 text-[11px] leading-4 whitespace-pre-wrap font-mono"
          style={{ color: 'var(--color-text-secondary)' }}>
          {content}
        </motion.pre>
      )}
      </AnimatePresence>
    </div>
  );
}

/** Человекочитаемое число токенов. */
function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/** Индикатор расхода контекстного окна: процент, детали и кнопка сжатия истории. */
function ContextMeter({ onCompact }: { onCompact: () => void }) {
  const usage = useOpenCoreStore(s => s.usage);
  const [open, setOpen] = useState(false);
  const limit = usage.limit || 128_000;
  const pct = Math.min(100, Math.round((usage.context / limit) * 100));
  const total = usage.input + usage.output;
  const color = pct >= 85 ? 'var(--color-error)' : pct >= 60 ? 'var(--color-warning)' : 'var(--color-primary)';
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} title="Расход контекста"
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-bold"
        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
        <Gauge size={11} style={{ color }} />
        <span style={{ color }}>{usage.estimated ? '~' : ''}{pct}%</span>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-40 mb-2 w-64 rounded-xl border p-3 text-[11px] shadow-xl"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 16px 40px rgba(0,0,0,.35)' }}>
          <p className="mb-1.5 text-xs font-black" style={{ color: 'var(--color-text)' }}>Контекст</p>
          <div className="mb-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--color-surface-2)' }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
          </div>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            Последний запрос: <b style={{ color: 'var(--color-text)' }}>{fmtNum(usage.context)}</b> / {fmtNum(limit)} токенов ({pct}%){usage.estimated ? ' — оценка' : ''}
          </p>
          <p className="mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            За сессию: {fmtNum(usage.input)} вход · {fmtNum(usage.output)} выход · <b style={{ color: 'var(--color-text)' }}>{fmtNum(total)}</b> всего
          </p>
          <button onClick={() => { setOpen(false); onCompact(); }}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 font-bold"
            style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
            <Minimize2 size={11} /> Сжать историю
          </button>
        </div>
      )}
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: 'build' | 'plan'; onChange: (m: 'build' | 'plan') => void }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg p-0.5" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
      <button onClick={() => onChange('build')} title="Build — выполняет задачи"
        className={`flex items-center gap-1 rounded-[7px] px-2 py-1 text-[10px] font-bold transition-colors ${mode === 'build' ? '' : 'opacity-50 hover:opacity-80'}`}
        style={mode === 'build'
          ? { background: 'var(--color-primary)', color: 'var(--color-primary-text)' }
          : { color: 'var(--color-text-secondary)' }}>
        <Hammer size={11} /> Build
      </button>
      <button onClick={() => onChange('plan')} title="Plan — только план, без изменений"
        className={`flex items-center gap-1 rounded-[7px] px-2 py-1 text-[10px] font-bold transition-colors ${mode === 'plan' ? '' : 'opacity-50 hover:opacity-80'}`}
        style={mode === 'plan'
          ? { background: 'var(--color-primary)', color: 'var(--color-primary-text)' }
          : { color: 'var(--color-text-secondary)' }}>
        <DraftingCompass size={11} /> Plan
      </button>
    </div>
  );
}

function ChatBubble({ m, onContinue, streaming }: { m: ChatMessage; onContinue?: () => void; streaming?: boolean }) {
  const cfg = useOpenCoreStore(s => s.config);
  const [copied, setCopied] = useState(false);
  const providers = activeProviders(cfg).filter(p => isProviderEnabled(p, cfg));
  const activeProv = providers.find(p => p.id === cfg.activeProviderId) ?? firstConnectedProvider(cfg);
  const meta = [m.model, activeProv?.name].filter(Boolean).join(' · ');
  const copy = async () => {
    await copyToClipboard(m.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const actions = (
    <div className="absolute -top-2.5 right-2 z-10 flex items-center gap-0.5 rounded-full px-1 py-0.5 opacity-0 transition-opacity group-hover:opacity-100"
      style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', boxShadow: '0 4px 16px rgba(0,0,0,.25)' }}>
      {onContinue && (
        <button onClick={onContinue} title="Продолжить ответ с места обрыва"
          className="flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-surface)]"
          style={{ color: 'var(--color-text-secondary)' }}>
          <CornerDownRight size={11} />
        </button>
      )}
      <button onClick={() => void copy()} title="Скопировать текст"
        className="flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-surface)]"
        style={{ color: copied ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
      {m.role === 'assistant' && meta && (
        <span className="hidden max-w-[220px] truncate px-1 text-[9px] font-semibold min-[480px]:inline"
          style={{ color: 'var(--color-text-tertiary)' }}>{meta}</span>
      )}
    </div>
  );
  if (m.role === 'tool') {
    return <ToolMsg name={m.toolName ?? m.content.slice(0, 40)} content={m.content} error={m.error} />;
  }
  if (m.role === 'user') {
    return (
      <div className="group relative flex justify-end">
        {actions}
        <div className="max-w-[80%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-[13px] leading-6" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', cursor: 'text', userSelect: 'text' }}>
          <Markdown text={m.content} />
          {m.attachments && m.attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {m.attachments.map((a, i) => <AttachmentChip key={i} a={a} />)}
            </div>
          )}
        </div>
      </div>
    );
  }
  // assistant
  return (
    <div className="group relative flex justify-start">
      {actions}
      <div className="max-w-[92%] min-w-0 flex-1">
        {m.thinking && <ThinkingBlock text={m.thinking} />}
        {m.content ? (
          <div className="rounded-2xl rounded-bl-md px-3.5 py-2.5" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', cursor: 'text', userSelect: 'text' }}>
            <Markdown text={m.content} streaming={streaming} />
          </div>
        ) : (
          null
        )}
        {m.error && <p className="mt-1 text-[11px]" style={{ color: 'var(--color-error)' }}>Это сообщение могло быть сгенерировано ошибочно. Проверь контекст и попробуй ещё раз.</p>}
      </div>
    </div>
  );
}

/** Карточка прикреплённого файла: бейдж расширения, размер, имя и «Скачать» в «Загрузки». */
function AttachmentChip({ a, onRemove }: { a: Attachment; onRemove?: () => void }) {
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle');
  const isImg = a.type.startsWith('image/') && !!a.dataUrl;
  const save = async () => {
    if (state === 'saving') return;
    const b64 = a.base64 ?? (a.dataUrl ? a.dataUrl.split(',')[1] : '');
    if (!b64) return;
    setState('saving');
    try {
      await invoke('op_save_to_downloads', { fileName: a.name, b64 });
      setState('done');
      setTimeout(() => setState('idle'), 1800);
    } catch (e) {
      console.error('[OpenPortal] download failed', e);
      setState('idle');
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[11px]" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
      {isImg
        ? <img src={a.dataUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
        : <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[7px] font-black"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}>{extOf(a.name)}</div>}
      <div className="min-w-0">
        <p className="max-w-[150px] truncate font-semibold leading-4" style={{ color: 'var(--color-text)' }}>{a.name}</p>
        <p className="text-[9px] leading-3" style={{ color: 'var(--color-text-tertiary)' }}>{extOf(a.name)} · {a.size ? fmtSize(a.size) : '—'}</p>
      </div>
      <button onClick={() => void save()} title="Скачать в «Загрузки»"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-surface)]"
        style={{ color: state === 'done' ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>
        {state === 'saving'
          ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          : state === 'done' ? <Check size={12} /> : <Download size={12} />}
      </button>
      {onRemove && (
        <button onClick={onRemove} title="Убрать" className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-error)]">✕</button>
      )}
    </div>
  );
}

function CurrentModelPicker() {
  const cfg = useOpenCoreStore(s => s.config);
  const setActiveModel = useOpenCoreStore(s => s.setActiveModel);
  const setModelsMenuOpen = useOpenCoreStore(s => s.setModelsMenuOpen);
  const [open, setOpen] = useState(false);

  const providers = activeProviders(cfg).filter(p => isProviderEnabled(p, cfg));
  const activeProvider = providers.find(p => p.id === cfg.activeProviderId) ?? firstConnectedProvider(cfg);
  if (!activeProvider) return null;

  const models = activeProvider.models.filter(m => isModelEnabled(activeProvider, m.id, cfg));
  const currentIsAvailable = models.some(m => m.id === cfg.activeModelId);

  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen(o => !o)} title="Выбор модели"
        className="flex max-w-[190px] items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold transition-colors hover:bg-[var(--color-surface-2)]"
        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
        <Sparkles size={12} style={{ color: 'var(--color-primary)' }} />
        <span className="truncate">{currentIsAvailable ? cfg.activeModelId : activeProvider.name}</span>
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-tertiary)' }} />
      </button>
      <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full right-0 z-50 mb-2 w-56 rounded-2xl border p-1.5"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 24px 60px rgba(0,0,0,.4)' }}>
            <p className="px-2 py-1 text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>{activeProvider.name}</p>
            <div className="max-h-40 overflow-y-auto">
              {models.map(m => (
                <button key={m.id} onClick={() => { setActiveModel(activeProvider.id, m.id); setOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--color-surface-2)]"
                  style={{ color: cfg.activeModelId === m.id ? 'var(--color-primary)' : 'var(--color-text)' }}>
                  <div className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: cfg.activeModelId === m.id ? 'var(--color-primary)' : 'var(--color-border)' }} />
                  <span className="flex-1 truncate font-semibold">{m.name ?? m.id}</span>
                  {m.reasoning && <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>think</span>}
                </button>
              ))}
            </div>
            <button onClick={() => { setOpen(false); setModelsMenuOpen(true); }}
              className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-1.5 text-[10px] font-bold transition-colors hover:opacity-80"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
              <Settings2 size={11} /> Управление моделями
            </button>
          </motion.div>
        </>
      )}
      </AnimatePresence>
    </div>
  );
}

/** Выбор рабочей сборки: «Без сборки» или конкретная сборка (иконка + название). */
function BuildPicker() {
  const instances = useInstanceStore(s => s.instances);
  const cfg = useOpenCoreStore(s => s.config);
  const setProject = useOpenCoreStore(s => s.setProject);
  const [open, setOpen] = useState(false);

  const project = cfg.project ?? { kind: 'none' as const };
  const active = project.kind === 'build'
    ? instances.find(i => i.id === project.instanceId)
    : undefined;

  const choose = (project: ProjectContext) => {
    setProject(project);
    setOpen(false);
  };

  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen(o => !o)} title="Сборка — рабочая область агента"
        className="flex max-w-[210px] items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold"
        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
        {active?.iconPath
          ? <img src={toIconSrc(active.iconPath)} alt="" className="h-4 w-4 shrink-0 rounded object-cover" />
          : active
            ? <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-black"
                style={{ background: active.color || 'var(--color-primary)', color: '#fff' }}>
                {active.name.slice(0, 1).toUpperCase()}
              </span>
            : <Boxes size={13} className="shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />}
        <span className="truncate">{active ? active.name : 'Без сборки'}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-tertiary)' }} />
      </button>
      <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl border p-2"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 24px 60px rgba(0,0,0,.4)' }}>
            <button onClick={() => choose({ kind: 'none' })}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-[var(--color-surface-2)]"
              style={{ color: !active ? 'var(--color-primary)' : 'var(--color-text)' }}>
              <Boxes size={14} className="shrink-0" />
              <span className="flex-1 font-semibold">Без сборки</span>
              {!active && <Check size={13} className="text-[var(--color-primary)]" />}
            </button>
            <p className="px-2 pt-2 pb-1 text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Сборки</p>
            <div className="max-h-60 overflow-y-auto">
              {instances.map(inst => (
                <button key={inst.id} onClick={() => choose({ kind: 'build', instanceId: inst.id })}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-[var(--color-surface-2)]"
                  style={{ color: active?.id === inst.id ? 'var(--color-primary)' : 'var(--color-text)' }}>
                  {inst.iconPath
                    ? <img src={toIconSrc(inst.iconPath)} alt="" className="h-5 w-5 shrink-0 rounded object-cover" />
                    : <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-black"
                        style={{ background: inst.color || 'var(--color-primary)', color: '#fff' }}>
                        {inst.name.slice(0, 1).toUpperCase()}
                      </span>}
                  <span className="min-w-0 flex-1 truncate font-semibold">{inst.name}</span>
                  {active?.id === inst.id && <Check size={13} className="shrink-0 text-[var(--color-primary)]" />}
                </button>
              ))}
              {instances.length === 0 && (
                <p className="px-2.5 py-2 text-[11px] leading-5" style={{ color: 'var(--color-text-tertiary)' }}>
                  Сборок пока нет. Создай их в разделе «Библиотека», чтобы агент мог с ними работать.
                </p>
              )}
            </div>
            <p className="mt-1 border-t px-2.5 pt-2 text-[10px] leading-4" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}>
              Агент получит доступ к папке выбранной сборки. Запись — только через подтверждение в модалке.
            </p>
          </motion.div>
        </>
      )}
      </AnimatePresence>
    </div>
  );
}

export function OpenPortalPage() {
  const navigate = useNavigate();
  const store = useOpenCoreStore();
  const sessions = useOpenCoreStore(s => s.sessions);
  const messages = useOpenCoreStore(s => s.messages);
  const currentSessionId = useOpenCoreStore(s => s.currentSessionId);
  const runningSessions = useOpenCoreStore(s => s.runningSessions);
  const running = !!(currentSessionId && runningSessions[currentSessionId]);
  const cfg = useOpenCoreStore(s => s.config);
  const layout = useOpenCoreStore(s => s.layout);
  const user = useCurrentUser();

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const abortRefs = useRef<Record<string, AbortController>>({});
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  /** Авто-рост поля ввода: до 160px, дальше — прокрутка. */
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  /** Держим ленту у последнего сообщения: пока агент работает — только если
   *  пользователь уже внизу; в остальное время всегда опускаемся к концу. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (running) {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    } else {
      stickRef.current = true;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, currentSessionId, running]);

  const init = useOpenCoreStore(s => s.init);
  useEffect(() => { void init(); }, [init]);

  /** Открывает / очищает кеш зависимостей песочницы (Cache/deps), кнопкой показывая результат в чате. */
  const runCacheCommand = useCallback(async (clean: boolean) => {
    const append = (content: string) =>
      useOpenCoreStore.getState().appendMessages([{ id: `sys-${Date.now()}`, role: 'assistant', content, timestamp: Date.now() }]);
    try {
      const info = clean
        ? await invoke<{ root: string; deps: { name: string; path: string; size: number }[]; total_size: number }>('op_clear_cache')
        : await invoke<{ root: string; deps: { name: string; path: string; size: number }[]; total_size: number }>('op_cache_info');
      const lines = info.deps.map(d => `- \`${d.name}\` — ${fmtSize(d.size)}`).join('\n');
      const head = clean ? '**Кеш зависимостей очищен.**' : '**Кеш зависимостей песочницы:**';
      append(`${head}\n\n${lines}\n\n**Суммарно:** ${fmtSize(info.total_size)}\n\nПапка: \`${info.root}\`\nИзображения (Cache/images) и проекты не затрагиваются.`);
    } catch (e) {
      append(`Не удалось прочитать кеш: ${String(e)}`);
    }
  }, []);

  /** Выполняет мгновенную команду «/», возвращает true, если команда обработана. */
  const runCommandLine = useCallback((raw: string): boolean => {
    const cmd = raw.split(/\s+/)[0].toLowerCase();
    if (cmd === '/new') { void store.newSession(); return true; }
    if (cmd === '/clear') { useOpenCoreStore.setState({ messages: [] }); return true; }
    if (cmd === '/plan' || cmd === '/build') {
      useOpenCoreStore.getState().setMode(cmd === '/plan' ? 'plan' : 'build');
      void store.newSession();
      return true;
    }
    if (cmd === '/models') { useOpenCoreStore.getState().setModelsMenuOpen(true); return true; }
    if (cmd === '/cache') { void runCacheCommand(/^\/cache\s+clean\b/i.test(raw)); return true; }
    if (cmd === '/help') {
      const msg: ChatMessage = { id: `sys-${Date.now()}`, role: 'assistant', content: HELP_TEXT, timestamp: Date.now() };
      useOpenCoreStore.getState().appendMessages([msg]);
      return true;
    }
    return false;
  }, [store]);

  const requestPermission = useCallback(async (req: PermissionRequest): Promise<'allow' | 'deny' | 'always' | 'never'> => {
    const key = `${req.tool}:${req.root}`;
    const prior = useOpenCoreStore.getState().permissions[key];
    if (prior === 'always') return 'always';
    if (prior === 'never') return 'never';
    if (prior === 'once') return 'allow';

    return new Promise<'allow' | 'deny' | 'always' | 'never'>(resolve => {
      useOpenCoreStore.setState({ pendingPermission: { ...req, resolve } });
    });
  }, []);

  /** Сжимает старую часть истории в краткую выжимку (моделью), оставляя последние сообщения как есть. */
  const compressChat = useCallback(async () => {
    const st = useOpenCoreStore.getState();
    const all = st.messages;
    if (all.length < 8) {
      st.appendMessages([{ id: `sys-${Date.now()}`, role: 'assistant', content: 'История и так короткая — сжимать нечего.', timestamp: Date.now() }]);
      return;
    }
    const sid = st.currentSessionId;
    if (!sid) return;
    const cfgNow = st.config;
    const activePt = activeProviders(cfgNow).find(p => p.id === cfgNow.activeProviderId && isProviderEnabled(p, cfgNow) && p.models.length > 0) ?? firstConnectedProvider(cfgNow);
    if (!activePt || activePt.models.length === 0) {
      st.appendMessages([{ id: `sys-${Date.now()}`, role: 'assistant', content: 'Нет подключённого провайдера для сжатия.', timestamp: Date.now() }]);
      return;
    }
    const modelId = cfgNow.activeModelId || activePt.models[0].id;
    const keep = all.slice(-6);
    const older = all.slice(0, all.length - keep.length);
    const transcript = older
      .map(m => `${m.role === 'user' ? 'ПОЛЬЗОВАТЕЛЬ' : m.role === 'assistant' ? 'АГЕНТ' : 'ИНСТРУМЕНТ'}: ${m.content}`)
      .join('\n\n')
      .slice(0, 60_000);
    const ep = resolveEndpoint(activePt.id, modelId, cfgNow.providers);
    ep.serviceTokens = cfgNow.serviceTokens ?? {};
    const notice: ChatMessage = { id: `sys-${Date.now()}`, role: 'assistant', content: 'Сжимаю историю…', timestamp: Date.now() };
    st.appendMessages([notice]);
    st.setSessionRunning(sid, true);
    try {
      const outcome = await callProvider(
        ep,
        'Ты сжимаешь длинную переписку агента и пользователя в краткую, но содержательную выжимку. Сохрани цель, принятые решения, изменённые файлы и пути, важные факты и открытые задачи. Ответь ТОЛЬКО текстом выжимки, инструменты не вызывай.',
        [{ role: 'user', content: transcript }],
      );
      const summary = (outcome.text || '').trim() || '(модель не вернула текст выжимки)';
      const summaryMsg: ChatMessage = {
        id: `summary-${Date.now()}`, role: 'assistant',
        content: `**Сжатая история** (${older.length} сообщений свёрнуто)\n\n${summary}`,
        timestamp: Date.now(),
      };
      useOpenCoreStore.setState({ messages: [summaryMsg, ...keep] });
    } catch (e) {
      useOpenCoreStore.getState().updateMessage(notice.id, { content: `Не удалось сжать историю: ${e instanceof Error ? e.message : String(e)}`, error: true });
    } finally {
      useOpenCoreStore.getState().setSessionRunning(sid, false);
      void persistSession(sid);
    }
  }, []);

  async function persistSession(targetId?: string) {
    const sid = targetId ?? useOpenCoreStore.getState().currentSessionId;
    if (!sid) return;
    const msgs = useOpenCoreStore.getState().readSessionMessages(sid);
    const cfgNow = useOpenCoreStore.getState().config;
    const firstUser = msgs.find(m => m.role === 'user');
    const title = firstUser ? firstUser.content.replace(/\s+/g, ' ').slice(0, 60) : 'Новая сессия';
    const data: SessionData = {
      id: sid,
      title,
      createdAt: Date.now(),
      updated: Date.now(),
      modelId: cfgNow.activeModelId,
      providerId: cfgNow.activeProviderId,
      mode: cfgNow.mode,
      cwd: cfgNow.cwd,
      messages: msgs,
    };
    try {
      await invoke('op_save_session', { sessionId: sid, payload: JSON.stringify(data) });
      // Обновить заголовок в списке
      useOpenCoreStore.setState({
        sessions: useOpenCoreStore.getState().sessions.map(s => s.id === sid
          ? { ...s, title, updated: data.updated, message_count: msgs.length }
          : s),
      });
    } catch (e) {
      console.error('[OpenPortal] save session failed', e);
    }
  }

  const send = useCallback(async (overrideText?: string) => {
    const isOverride = typeof overrideText === 'string';
    let text = (overrideText ?? input).trim();
    if (!text || running) return;
    if (!isOverride) setInput('');

    // Команды "/"
    let taskDirective: string | undefined;
    if (text.startsWith('/')) {
      const cmd = text.split(/\s+/)[0].toLowerCase();
      const arg = text.slice(cmd.length).trim();
      if (runCommandLine(text)) return;
      if (cmd === '/compress') { await compressChat(); return; }
      if (cmd === '/context') {
        const u = useOpenCoreStore.getState().usage;
        const lim = u.limit || 128_000;
        const pct = Math.min(100, Math.round((u.context / lim) * 100));
        const m: ChatMessage = {
          id: `sys-${Date.now()}`, role: 'assistant', timestamp: Date.now(),
          content: `**Контекст**: ${u.context} / ${lim} токенов (${pct}%)${u.estimated ? ' — оценка' : ''}\n` +
            `**За сессию**: ${u.input} вход · ${u.output} выход · ${u.input + u.output} всего` +
            (pct >= 70 ? '\n\nИстория приближается к лимиту — нажми «Сжать историю» в индикаторе контекста или отправь `/compress`.' : ''),
        };
        useOpenCoreStore.getState().appendMessages([m]);
        return;
      }
      if (cmd === '/skill-creator' || cmd === '/skill-installer') {
        if (!arg) {
          const msg: ChatMessage = {
            id: `sys-${Date.now()}`, role: 'assistant',
            content: cmd === '/skill-creator'
              ? 'Опиши навык: `/skill-creator <описание>`'
              : 'Укажи имя/ссылку: `/skill-installer <что ищем>`',
            timestamp: Date.now(),
          };
          useOpenCoreStore.getState().appendMessages([msg]);
          return;
        }
        if (cmd === '/skill-creator') {
          taskDirective = `Ты запущен командой /skill-creator. Задача: создать новый навык для агента «${arg}». Навык — папка <portal base>/Skills/<slug>/SKILL.md с frontmatter (name, description) и инструкциями. Используй write_text.`;
          text = `Команда /skill-creator: создай навык «${arg}» и сохрани его SKILL.md в папке навыков.`;
        } else {
          taskDirective = `Ты запущен командой /skill-installer. Задача: найти в интернете (web_search) навык «${arg}», скачать содержимое и установить как <portal base>/Skills/<slug>/SKILL.md с frontmatter (name, description).`;
          text = `Команда /skill-installer: найди подходящий навык «${arg}», установи его SKILL.md в папку навыков и кратко объясни, что он делает.`;
        }
      } else {
        const unknown: ChatMessage = { id: `sys-${Date.now()}`, role: 'assistant', content: `Неизвестная команда **${cmd}**. Набери /help`, timestamp: Date.now() };
        useOpenCoreStore.getState().appendMessages([unknown]);
        return;
      }
    }

    // Только подключённые провайдеры: если активный выключен/отсутствует — переключаемся на подключённый.
    const cfgNow = useOpenCoreStore.getState().config;
    const activePt = activeProviders(cfgNow).find(p => p.id === cfg.activeProviderId && isProviderEnabled(p, cfgNow) && p.models.length > 0);
    let providerId = cfg.activeProviderId;
    let modelId = cfg.activeModelId;
    if (!activePt) {
      const fallback = firstConnectedProvider(cfgNow);
      if (fallback && fallback.models.length > 0) {
        providerId = fallback.id;
        modelId = fallback.models[0]?.id ?? '';
        useOpenCoreStore.getState().setActiveModel(providerId, modelId);
      } else {
        const sysMsg: ChatMessage = {
          id: `sys-${Date.now()}`, role: 'assistant',
          content: 'Нет подключённого провайдера. Открой «Управление моделями» и подключи провайдера — по умолчанию работает бесплатный OpenCode Zen.',
          timestamp: Date.now(),
        };
        useOpenCoreStore.getState().appendMessages([sysMsg]);
        useOpenCoreStore.getState().setModelsMenuOpen(true);
        return;
      }
    }

    // Создать сессию только если чат открыт с нуля; иначе используем текущую и переименуем её при сохранении.
    let sessionId = store.currentSessionId;
    if (!sessionId) {
      await store.newSession();
      sessionId = useOpenCoreStore.getState().currentSessionId;
    }
    const runSessionId = sessionId;
    if (!runSessionId) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`, role: 'user', content: text, attachments: attachments.length ? attachments : undefined, timestamp: Date.now(),
    };
    useOpenCoreStore.getState().appendSessionMessages(runSessionId, [userMsg]);
    setAttachments([]);

    const mode: 'build' | 'plan' = taskDirective ? 'build' : cfg.mode;
    const ep = resolveEndpoint(providerId, modelId, cfgNow.providers);
    ep.serviceTokens = useOpenCoreStore.getState().config.serviceTokens ?? {};
    ep.onSetToken = (host, token) => useOpenCoreStore.getState().setServiceToken(host, token);

    const portalRoot = layout?.projects ?? '';
    const proj = cfg.project ?? { kind: 'none' as const };
    let workspaceLabel = 'OpenPortal Projects';
    let workspaceDir = portalRoot;
    let workspaceZone: 'portal' | 'launcher' = 'portal';
    if (proj.kind === 'build' && proj.instanceId) {
      const inst = useInstanceStore.getState().instances.find(i => i.id === proj.instanceId);
      workspaceLabel = inst?.name ?? proj.instanceId;
      try {
        workspaceDir = await invoke<string>('op_resolve_build', { instanceId: proj.instanceId });
        workspaceZone = 'launcher';
      } catch { /* папка сборки не определилась — остаёмся на portal */ }
    }
    const extraBase = layout
      ? `Игрок (Minecraft-ник): ${user?.username || 'игрок'}\nРабочая область агента: ${workspaceLabel}${workspaceZone === 'launcher' ? ' (сборка)' : ''}\nПапка: ${workspaceDir}\nПрава: ${workspaceZone === 'launcher' ? 'чтение лаунчера везде; запись — только в папку сборки и в settings.json' : 'полный доступ внутри OpenPortal Projects'}\nВременная (Temp): ${layout.temp}\nКаталог лаунчера: ${layout.launcher}\nПортал (OpenPortal): ${layout.base}\nАктивная модель: ${modelId} (${ep.provider.name}).`
      : undefined;
    const extra = taskDirective && extraBase
      ? `${extraBase}\nПапка навыков агента: ${layout?.base}\\Skills`
      : extraBase;
    const skills = store.skills.length
      ? store.skills.map(s => `- ${s.name} — ${s.description || 'нет описания'}`).join('\n')
      : undefined;
    const systemPrompt = buildSystemPrompt({
      mode,
      extra: taskDirective ? `${extra ?? ''}\n\n${taskDirective}`.trim() : extra,
      skills,
    });

    const abort = new AbortController();
    abortRefs.current[runSessionId] = abort;
    useOpenCoreStore.getState().setSessionRunning(runSessionId, true);

    const ctxLimit = ep.model.contextLength ?? (ep.model.family === 'anthropic' ? 200_000 : 128_000);
    if (runSessionId === useOpenCoreStore.getState().currentSessionId) useOpenCoreStore.getState().setContextLimit(ctxLimit);

    try {
      const currentMsgs = useOpenCoreStore.getState().readSessionMessages(runSessionId);
      const history = compressHistory(currentMsgs, 36);
      await runAgentTurn({
        ep,
        systemPrompt,
        input: history,
        mode,
        requestPermission,
        signal: abort.signal,
        onAppend: msgs => useOpenCoreStore.getState().appendSessionMessages(runSessionId, msgs),
        onUpdate: (id, patch) => useOpenCoreStore.getState().updateSessionMessage(runSessionId, id, patch),
        onReplace: msgs => useOpenCoreStore.getState().replaceSessionMessages(runSessionId, msgs),
        onUsage: u => { if (runSessionId === useOpenCoreStore.getState().currentSessionId) useOpenCoreStore.getState().addUsage(u); },
      });
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      const msg: ChatMessage = {
        id: `err-${Date.now()}`, role: 'assistant',
        content: err.startsWith('Отменено') ? 'Задача остановлена вами.' : `Ошибка: ${err}`,
        error: true, timestamp: Date.now(),
      };
      useOpenCoreStore.getState().appendSessionMessages(runSessionId, [msg]);
    } finally {
      useOpenCoreStore.getState().setSessionRunning(runSessionId, false);
      delete abortRefs.current[runSessionId];
      void persistSession(runSessionId);
    }
  }, [input, running, store, cfg, layout, attachments, requestPermission, user?.username, compressChat]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  const cmdOpen = !running && input.startsWith('/');
  const cmdQuery = input.slice(1).toLowerCase();
  const cmdList = cmdOpen ? COMMANDS.filter(c => c.cmd.slice(1).toLowerCase().includes(cmdQuery)) : [];
  const lastAssistantId = [...messages].reverse().find(m => m.role === 'assistant' && m.content)?.id;

  const onFilePicked = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64 = dataUrl.split(',')[1] ?? '';
      setAttachments(prev => [...prev, { name: file.name, type: file.type || 'application/octet-stream', size: file.size, dataUrl, base64 }]);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg text-[12px] font-black"
            style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>OP</div>
          <h2 className="flex-1 text-sm font-black" style={{ color: 'var(--color-text)' }}>OpenPortal</h2>
          <button onClick={() => void store.newSession()} title="Новый чат"
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-surface-2)]" style={{ color: 'var(--color-text-secondary)' }}>
            <Plus size={15} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          {sessions.map(s => (
            <button key={s.id} onClick={() => void store.openSession(s.id)}
              className={`group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors ${s.id === currentSessionId ? '' : 'hover:bg-[var(--color-surface-2)]'}`}
              style={s.id === currentSessionId
                ? { background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }
                : { border: '1px solid transparent' }}>
              {runningSessions[s.id]
                ? <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-[var(--color-primary)] border-t-transparent" />
                : <MessageSquare size={13} className="shrink-0" style={{ color: s.id === currentSessionId ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }} />}
              <span className="min-w-0 flex-1 truncate text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{s.title}</span>
              <span className="hidden shrink-0 group-hover:inline-block" onClick={e => { e.stopPropagation(); void store.deleteSession(s.id); }}>
                <Trash2 size={12} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-error)]" />
              </span>
            </button>
          ))}
          {sessions.length === 0 && (
            <p className="px-3 py-3 text-[11px] leading-5" style={{ color: 'var(--color-text-tertiary)' }}>Чатов пока нет. Нажми «+», чтобы начать новую сессию.</p>
          )}
        </div>
        <div className="border-t p-3" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={() => navigate('/home')}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-colors hover:bg-[var(--color-surface-2)]"
            style={{ color: 'var(--color-text-secondary)' }}>
            <ChevronLeft size={14} /> В лаунчер
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="ore-plain flex items-center gap-3 border-b px-5 py-3" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <Bot size={15} style={{ color: 'var(--color-primary)' }} />
            <span className="text-xs font-black" style={{ color: 'var(--color-text)' }}>OpenPortal</span>
          </div>
          <span
            className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold"
            title={running ? 'Агент выполняет задачу' : 'Агент свободен'}
            style={running
              ? { background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)', color: 'var(--color-primary)' }
              : { background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)' }}>
            {running
              ? <><span className="h-2 w-2 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />работает</>
              : <><span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-success)' }} />готов</>}
          </span>
          <div className="flex-1" />
          <BuildPicker />
        </header>

        <div ref={scrollRef} onScroll={() => {
            const el = scrollRef.current;
            if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          }} className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2">
              <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-2xl"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                <Sparkles size={26} className="text-[var(--color-primary)]" />
              </div>
              <h1 className="text-lg font-black" style={{ color: 'var(--color-text)' }}>OpenPortal</h1>
              <p className="max-w-sm text-center text-xs leading-5" style={{ color: 'var(--color-text-secondary)' }}>
                Встроенный ИИ-агент лаунчера. Режим <b>Build</b> — выполняет задачи с файлами и командами, <b>Plan</b> — только план.
                Команды: <code className="font-mono text-[var(--color-primary)]">/help</code>
              </p>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              {messages.map(m => (
                <ChatBubble key={m.id} m={m} streaming={running && m.id === lastAssistantId}
                  onContinue={m.id === lastAssistantId && !running
                    ? () => void send('Продолжи ровно с того места, где ты остановился. Не повторяй уже написанное и не начинай заново — просто продолжи.')
                    : undefined} />
              ))}
              {running && (
                <div className="flex items-center gap-2 px-1 py-1 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
                  OpenPortal думает…
                </div>
              )}
            </div>
          )}
        </div>

        <div className="ore-plain relative border-t p-4" style={{ borderColor: 'var(--color-border)' }}>
          {cmdOpen && cmdList.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 z-30 mx-auto mb-2 w-full max-w-3xl overflow-hidden rounded-2xl border p-1.5 shadow-xl"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 24px 60px rgba(0,0,0,.4)' }}>
              {cmdList.map(c => (
                <button key={c.cmd} onClick={() => {
                  if (c.instant) { setInput(''); if (!runCommandLine(c.cmd)) void send(c.cmd); }
                  else setInput(`${c.cmd} `);
                }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-2)]">
                  <span className="shrink-0 font-mono text-[11px] font-bold" style={{ color: 'var(--color-primary)' }}>{c.cmd}</span>
                  <span className="truncate text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{c.desc}</span>
                  {!c.instant && <span className="ml-auto shrink-0 text-[9px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>+ описание</span>}
                </button>
              ))}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((a, i) => (
                <AttachmentChip key={i} a={a} onRemove={() => setAttachments(prev => prev.filter((_, j) => j !== i))} />
              ))}
            </div>
          )}
          <div className="mx-auto mb-1.5 flex max-w-3xl items-center gap-1.5 px-1">
            <ModeToggle mode={cfg.mode} onChange={m => useOpenCoreStore.getState().setMode(m)} />
            <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>·</span>
            <CurrentModelPicker />
            <ContextMeter onCompact={() => void compressChat()} />
            <span className="flex-1" />
          </div>
          <div className="mx-auto flex max-w-3xl items-end gap-1.5">
            <input type="file" id="op-file" className="hidden" onChange={onFilePicked} />
            <label htmlFor="op-file" title="Прикрепить файл или картинку"
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-surface-2)]"
              style={{ border: '1px dashed var(--color-border)', color: 'var(--color-text-tertiary)' }}>
              <Plus size={15} />
            </label>
            <textarea
              ref={composerRef}
              value={input}
              onChange={e => { setInput(e.target.value); }}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={running ? 'Агент занят…' : 'Что сделать?  (/ — команды)'}
              className="max-h-40 min-h-10 flex-1 resize-none overflow-y-auto rounded-2xl px-4 py-2.5 text-[13px] leading-6 outline-none"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            />
            {running ? (
              <button onClick={() => { if (currentSessionId) abortRefs.current[currentSessionId]?.abort(); }} title="Остановить"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--color-error)' }}>
                <StopCircle size={16} />
              </button>
            ) : (
              <button onClick={() => void send()} title="Отправить" disabled={!input.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-opacity disabled:opacity-40"
                style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
                <Send size={15} />
              </button>
            )}
          </div>
          <p className="mt-2 text-center text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            OpenPortal может ошибаться. Проверяй важные изменения. Файлы, команды и ключи хранятся локально в папке OpenPortal.
          </p>
        </div>
      </main>

      <ModelManager />
      <PermissionModal />
    </div>
  );
}