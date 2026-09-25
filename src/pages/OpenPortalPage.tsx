import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, MessageSquare, Trash2, Sparkles, Send, StopCircle, ChevronDown, ChevronRight,
  Settings2, Bot, Hammer, DraftingCompass, Braces, ChevronLeft, Boxes, Check, Copy, Download,
  Gauge, Minimize2, CornerDownRight, Shield, ShieldCheck, ShieldAlert, Globe, ExternalLink,
  Package, Wand2, Image as ImageIcon, Search, X, FileDiff, Brain,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@/lib/invoke-shim';
import { useOpenCoreStore, activeProviders, isProviderEnabled, isModelEnabled, firstConnectedProvider } from '@/stores/opencoreStore';
import { useInstanceStore } from '@/stores/instanceStore';
import { useCurrentUser } from '@/stores/authStore';
import { toIconSrc } from '@/lib/icon-src';
import { resolveEndpoint, runAgentTurn, buildSystemPrompt, compressHistory, callProvider, estimateTokens } from '@/lib/opencore/agent';
import { contextWindow, BROWSER_LINKS } from '@/lib/opencore/providers';
import { Markdown, PortalImage } from '@/components/openportal/Markdown';
import { ModelManager } from '@/components/openportal/ModelManager';
import { PermissionModal } from '@/components/openportal/PermissionModal';
import type { ChatMessage, SessionData, SessionMeta, PermissionRequest, Attachment, ProjectContext, PermissionPreset, ModCard, FileChange } from '@/lib/opencore/types';

/** Русская форма множественного числа: plural(5, 'чат', 'чата', 'чатов') → 'чатов'. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** Стартовые темы пустого чата: клик подставляет готовую команду в композер. */
const START_TOPICS: { title: string; hint: string; prompt: string; icon: React.ReactNode; color: string }[] = [
  {
    title: 'Найти мод',
    hint: 'Оптимизации, библиотеки, механики',
    prompt: 'Найди мод на скорость и производительность для ',
    icon: <Package size={15} />,
    color: 'var(--color-primary)',
  },
  {
    title: 'Ресурс-пак',
    hint: 'Текстуры, темы, HD-паки',
    prompt: 'Найди ресурс-пак с текстурами высокого разрешения для ',
    icon: <ImageIcon size={15} />,
    color: 'var(--color-primary)',
  },
  {
    title: 'Шейдеры',
    hint: 'Complementary, SEUS, BSL',
    prompt: 'Найди шейдеры для ',
    icon: <Wand2 size={15} />,
    color: 'var(--color-primary)',
  },
  {
    title: 'Создать шейдер',
    hint: 'GLSL, свои .vsh/.fsh и zip',
    prompt: 'Создай шейдер для Minecraft',
    icon: <Wand2 size={15} />,
    color: 'var(--color-primary)',
  },
  {
    title: 'Создать мод',
    hint: 'Java, сборка в .jar',
    prompt: 'Создай мод для моей сборки: ',
    icon: <Boxes size={15} />,
    color: 'var(--color-primary)',
  },
  {
    title: 'Разобрать сборку',
    hint: 'Файлы, логи, установка модов',
    prompt: 'Посмотри мою сборку и объясни, что в ней установлено и что можно улучшить',
    icon: <Boxes size={15} />,
    color: 'var(--color-primary)',
  },
];

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
  'HTTP-запросы к API, скачивание любых файлов в песочницу, файлы (чтение/запись/точечная правка/поиск по коду), ' +
  'команды (cmd/PowerShell), запуск Python, сборка и разбор .jar, архивы, работа с изображениями, ' +
  'параллельные субагенты, генерация картинок.',
  '',
  '**Что агент умеет создавать прямо в лаунчере:** моды (Fabric/Forge/NeoForge/Quilt) с готовым .jar, ' +
  'шейдеры на GLSL (OptiFine/Iris), ресурс-паки и текстуры, скрипты на Python, конфиги и темы. ' +
  'Если просишь «создай» — он пишет код, а не ищет готовое. Если просишь «найди» — ищет и ставит.',
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
  { cmd: '/continue', desc: 'Продолжить прерванную задачу (например, после закрытия лаунчера)', instant: true },
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

/** base64 → строка UTF-8 (для встраивания содержимого текстовых вложений). */
function b64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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

function ToolMsg({ name, content, error, cards, changes, onInstalled }: { name: string; content: string; error?: boolean; cards?: ModCard[]; changes?: FileChange[]; onInstalled?: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  // Карточки результата mod_search показываются сразу, без раскрытия: раньше
  // агент отдавал только текст, и найденный контент приходилось читать вручную.
  const imgMatch = name === 'generate_image' ? /\/op-image\/([A-Za-z0-9-]+\.(?:png|jpg|jpeg|webp|gif|avif|heic))/i.exec(content) : null;
  const showCards = !error && cards && cards.length > 0;
  return (
    <div className="ore-plain mb-2 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-2)' }}>
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] font-semibold"
        style={{ color: error ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
        <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        {name}
        {showCards && <span className="rounded px-1 text-[9px] font-bold" style={{ background: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}>{cards!.length}</span>}
        <span className="ml-auto font-normal" style={{ color: 'var(--color-text-tertiary)' }}>{error ? 'ошибка' : 'ок'}</span>
      </button>
      {changes && changes.length > 0 && <FileChanges changes={changes} />}
      {showCards && (
        <div className="grid gap-1.5 border-t p-1.5" style={{ borderColor: 'var(--color-border)' }}>
          {cards!.map(card => <ModResultCard key={card.projectId + card.versionNumber} card={card} onInstalled={onInstalled} />)}
        </div>
      )}
      {imgMatch && !error && (
        <div className="pt-1.5 px-2.5">
          <PortalImage name={imgMatch[1]} />
          <span className="mt-1 block text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Сгенерированное изображение — можно открыть и скачать кнопкой рядом</span>
        </div>
      )}
      <AnimatePresence>
      {open && (
        <motion.pre initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          className="max-h-72 overflow-y-auto whitespace-pre-wrap px-2.5 pt-1.5 font-mono text-[11px] leading-4"
          style={{ color: 'var(--color-text-secondary)' }}>
          {content}
        </motion.pre>
      )}
      </AnimatePresence>
    </div>
  );
}

const MOD_TYPE_META: Record<string, { label: string; path: string }> = {
  mod: { label: 'Мод', path: 'mod' },
  resourcepack: { label: 'Ресурс-пак', path: 'resourcepack' },
  shaderpack: { label: 'Шейдер', path: 'shader' },
  modpack: { label: 'Модпак', path: 'modpack' },
};

const SOURCE_META: Record<string, { label: string; color: string }> = {
  modrinth: { label: 'Modrinth', color: 'var(--color-primary)' },
  curseforge: { label: 'CurseForge', color: 'var(--color-warning)' },
  other: { label: 'Другое', color: 'var(--color-text-tertiary)' },
};

/** Карточка найденного контента: иконка, название, описание, платформа, тип. */
function ModResultCard({ card, onInstalled }: { card: ModCard; onInstalled?: (text: string) => void }) {
  const type = MOD_TYPE_META[card.projectType] ?? MOD_TYPE_META.mod;
  const source = SOURCE_META[card.source] ?? SOURCE_META.other;
  const instances = useInstanceStore(s => s.instances);
  const project = useOpenCoreStore(s => s.config.project);
  const [detail, setDetail] = useState(false);
  const [pickBuild, setPickBuild] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const selectedId = project && project.kind === 'build' ? project.instanceId : '';
  const selectedName = instances.find(i => i.id === selectedId)?.name ?? '';

  const install = useCallback(async (instanceId: string) => {
    const inst = instances.find(i => i.id === instanceId);
    if (!inst || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await invoke<any[]>('install_mod', {
        instanceId,
        downloadUrl: card.downloadUrl,
        fileName: card.fileName,
        modId: card.projectId,
        modName: card.title,
        modVersion: card.versionNumber,
        versionId: '',
        source: card.source,
        modType: card.projectType,
        projectId: card.projectId,
        author: card.author,
        iconUrl: card.iconUrl,
      });
      const count = Array.isArray(res) ? res.length : 0;
      setDone(true);
      setPickBuild(false);
      // Агент сразу узнаёт об установке — сообщение уходит в тот же чат.
      onInstalled?.(`Установлено в сборку «${inst.name}»: ${card.title} (${type.label})${count ? `, файлов: ${count}` : ''}. Пересобери сборку, чтобы контент проиндексировался.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [card, instances, busy, onInstalled, type.label]);

  return (
    <div className="overflow-hidden rounded-md" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <button onClick={() => setDetail(d => !d)} title={detail ? 'Свернуть' : 'Открыть в лаунчере'}
        className="flex w-full items-start gap-2.5 p-2 text-left transition-colors hover:bg-[var(--color-surface-2)]">
        {card.iconUrl
          ? <img src={card.iconUrl} alt="" className="h-10 w-10 shrink-0 rounded" style={{ objectFit: 'cover', imageRendering: 'auto' }} />
          : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded text-[9px] font-black" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)' }}>{type.label.slice(0, 2).toUpperCase()}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[12px] font-bold" style={{ color: 'var(--color-text)' }}>{card.title}</span>
            {card.versionNumber && <span className="shrink-0 font-mono text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{card.versionNumber}</span>}
          </div>
          {card.description && <p className="mt-0.5 line-clamp-2 text-[11px] leading-4" style={{ color: 'var(--color-text-secondary)' }}>{card.description}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)' }}>{source.label}</span>
            <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>{type.label}</span>
            <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>{card.platform}</span>
            {card.loaders.slice(0, 3).map(l => <span key={l} className="rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)' }}>{l}</span>)}
            {card.gameVersions.slice(0, 2).map(v => <span key={v} className="rounded px-1.5 py-0.5 font-mono text-[9px]" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)' }}>{v}</span>)}
          </div>
        </div>
      </button>

      <div className="flex items-center gap-1.5 border-t px-2 py-1.5" style={{ borderColor: 'var(--color-border)' }}>
        {card.installable ? (
          done ? (
            <span className="text-[10px] font-bold" style={{ color: 'var(--color-success)' }}>Установлено</span>
          ) : selectedId ? (
            <button onClick={() => void install(selectedId)} disabled={busy}
              className="rounded px-2 py-1 text-[10px] font-bold disabled:opacity-50"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
              {busy ? 'Установка…' : `Установить в «${selectedName || 'сборку'}»`}
            </button>
          ) : (
            <button onClick={() => setPickBuild(true)}
              className="rounded px-2 py-1 text-[10px] font-bold"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
              Установить — выбрать сборку
            </button>
          )
        ) : (
          <span className="text-[10px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>Нет файла под выбранную версию</span>
        )}
        <span className="flex-1" />
        <span className="text-[9px]" style={{ color: card.installable ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
          {card.installable ? 'установка доступна' : 'не найден файл'}
        </span>
      </div>

      {error && <p className="px-2 pb-1.5 text-[10px]" style={{ color: 'var(--color-error)' }}>{error}</p>}

      {pickBuild && (
        <div className="border-t p-1.5" style={{ borderColor: 'var(--color-border)' }}>
          <p className="px-1 pb-1 text-[10px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>Куда установить?</p>
          <div className="max-h-40 overflow-y-auto">
            {instances.length === 0 && <p className="px-1 py-1 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Сборок пока нет.</p>}
            {instances.map(inst => (
              <button key={inst.id} onClick={() => void install(inst.id)} disabled={busy}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-[var(--color-surface-2)]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: inst.color || 'var(--color-surface-2)' }} />
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold" style={{ color: 'var(--color-text)' }}>{inst.name}</span>
                <span className="shrink-0 font-mono text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>{inst.minecraftVersion}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {detail && (
        <div className="border-t p-2.5" style={{ borderColor: 'var(--color-border)' }}>
          <div className="mb-2 flex items-center gap-2">
            <button onClick={() => setDetail(false)}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-bold"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
              <ChevronLeft size={11} /> Назад
            </button>
            <span className="flex-1" />
            <button onClick={() => { void invoke('open_url', { url: card.url }); }}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-bold"
              style={{ color: 'var(--color-text-tertiary)' }}>
              Открыть на Modrinth <ExternalLink size={10} />
            </button>
          </div>
          {card.iconUrl && (
            <img src={card.iconUrl} alt="" className="mb-2 w-full rounded" style={{ maxHeight: 180, objectFit: 'contain', imageRendering: 'auto' }} />
          )}
          <p className="whitespace-pre-wrap text-[12px] leading-5" style={{ color: 'var(--color-text-secondary)' }}>{card.description || 'Описание не указано.'}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {card.author && <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>автор: {card.author}</span>}
            <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>загрузок: {fmtNum(card.downloads)}</span>
            {card.fileName && <span className="rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)' }}>{card.fileName}</span>}
          </div>
          {card.gameVersions.length > 0 && (
            <p className="mt-1.5 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
              Версии: {card.gameVersions.slice(0, 12).join(', ')}
            </p>
          )}
        </div>
      )}
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
  const messages = useOpenCoreStore(s => s.messages);
  const cfg = useOpenCoreStore(s => s.config);
  const [open, setOpen] = useState(false);
  // ����� ���� �� �������� ������ ��������, � �� ������ �� usage.limit:
  // ������ �������� ����������� ���� ����� �������� ���������, �������
  // ����� ����� ����� ������ ���� ��������� ���������� 128K.
  const activeModel = useMemo(() => {
    const provider = activeProviders(cfg).find(p => p.id === cfg.activeProviderId) ?? firstConnectedProvider(cfg);
    if (!provider) return null;
    const model = provider.models.find(m => m.id === cfg.activeModelId);
    return model ? { model, providerId: provider.id } : null;
  }, [cfg]);
  const override = activeModel ? (cfg.modelContexts ?? {})[`${activeModel.providerId}/${activeModel.model.id}`] : undefined;
  const modelLimit = activeModel
    ? contextWindow({ ...activeModel.model, contextLength: override ?? activeModel.model.contextLength }, activeModel.providerId)
    : 0;
  const limit = modelLimit || usage.limit || 128_000;
  // Выжимки сжатой истории модель получает, но в расход контекста они не идут,
  // поэтому вычитаем их оценку из занятого места.
  const summaryTokens = useMemo(
    () => messages.filter(m => m.summary === true).reduce((sum, m) => sum + estimateTokens(m.content), 0),
    [messages],
  );
  const context = Math.max(0, usage.context - summaryTokens);
  const pct = Math.min(100, Math.round((context / limit) * 100));
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
        <div className="absolute bottom-full right-0 z-40 mb-2 w-64 rounded-lg border p-3 text-[11px]"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>
          <p className="mb-1.5 text-xs font-black" style={{ color: 'var(--color-text)' }}>Контекст</p>
          <div className="mb-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--color-surface-2)' }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
          </div>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            Последний запрос: <b style={{ color: 'var(--color-text)' }}>{fmtNum(context)}</b> / {fmtNum(limit)} токенов ({pct}%){usage.estimated ? ' — оценка' : ''}
          </p>
          {summaryTokens > 0 && (
            <p className="mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              Выжимки сжатой истории: {fmtNum(summaryTokens)} токенов — модель их видит, но в расход не входят.
            </p>
          )}
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

/** Блок выжимки сжатой истории: виден пользователю и модели, но не входит в расход контекста. */
function SummaryBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-2 overflow-hidden rounded-lg" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
        <ChevronRight size={12} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} style={{ color: 'var(--color-text-tertiary)' }} />
        <span className="text-[11px] font-bold" style={{ color: 'var(--color-text)' }}>Выжимка контекста</span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>виден модели, не входит в расход</span>
      </button>
      {open && (
        <div className="border-t px-3 py-2 text-[12px] leading-5" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
          <Markdown text={content} />
        </div>
      )}
    </div>
  );
}

/** Список изменённых файлов: «имя-файла +12 −3», разворачивается в diff. */
function FileChanges({ changes }: { changes: FileChange[] }) {
  const [openPath, setOpenPath] = useState<string | null>(null);
  return (
    <div className="mb-2 overflow-hidden rounded-lg" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <FileDiff size={12} style={{ color: 'var(--color-text-secondary)' }} />
        <span className="text-[11px] font-bold" style={{ color: 'var(--color-text)' }}>Изменённые файлы</span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{changes.length}</span>
      </div>
      <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
        {changes.map(change => {
          const key = `${change.root}/${change.path}`;
          const isOpen = openPath === key;
          return (
            <div key={key} className="border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
              <button onClick={() => setOpenPath(isOpen ? null : key)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--color-surface)]">
                <ChevronRight size={11} className={`shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} style={{ color: 'var(--color-text-tertiary)' }} />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]" style={{ color: 'var(--color-text)' }} title={key}>{change.path}</span>
                {change.created && <span className="shrink-0 rounded px-1 text-[9px] font-bold" style={{ background: 'var(--color-surface)', color: 'var(--color-success)' }}>новый</span>}
                <span className="shrink-0 font-mono text-[10px] font-bold" style={{ color: 'var(--color-success)' }}>+{change.added}</span>
                <span className="shrink-0 font-mono text-[10px] font-bold" style={{ color: 'var(--color-error)' }}>−{change.removed}</span>
              </button>
              {isOpen && (
                <div className="max-h-72 overflow-auto border-t px-2 py-1.5" style={{ borderColor: 'var(--color-border)' }}>
                  {change.lines.length === 0 && <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Нет строк для показа.</p>}
                  {change.lines.map((line, i) => (
                    <div key={i} className="flex items-start gap-2 font-mono text-[10px] leading-4"
                      style={{
                        background: line.kind === 'add' ? 'rgba(38,166,65,0.12)'
                          : line.kind === 'remove' ? 'rgba(218,54,51,0.12)' : 'transparent',
                        color: line.kind === 'context' ? 'var(--color-text-tertiary)' : 'var(--color-text)',
                      }}>
                      <span className="w-8 shrink-0 select-none text-right" style={{ color: 'var(--color-text-tertiary)' }}>{line.after ?? ''}</span>
                      <span className="w-2 shrink-0 select-none" style={{ color: line.kind === 'add' ? 'var(--color-success)' : line.kind === 'remove' ? 'var(--color-error)' : 'transparent' }}>
                        {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}
                      </span>
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{line.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
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

function EffortPicker({ value, onChange }: { value: 'minimal' | 'low' | 'medium' | 'high'; onChange: (v: 'minimal' | 'low' | 'medium' | 'high') => void }) {
  const [open, setOpen] = useState(false);
  const levels: { id: 'minimal' | 'low' | 'medium' | 'high'; label: string; title: string }[] = [
    { id: 'minimal', label: 'Мин', title: 'Минимум рассуждений — быстрее и дешевле' },
    { id: 'low', label: 'Низ', title: 'Немного рассуждений' },
    { id: 'medium', label: 'Сред', title: 'Обычный уровень рассуждений' },
    { id: 'high', label: 'Выс', title: 'Максимум рассуждений — медленнее, но внимательнее' },
  ];
  const current = levels.find(l => l.id === value) ?? levels[2];
  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen(o => !o)} title={current.title}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold transition-colors hover:bg-[var(--color-surface)]"
        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
        <Brain size={11} style={{ color: 'var(--color-primary)' }} />
        {current.label}
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-tertiary)' }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-50 mb-2 w-40 overflow-hidden rounded-lg border p-1"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>
            {levels.map(l => (
              <button key={l.id} title={l.title} onClick={() => { onChange(l.id); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] font-semibold transition-colors hover:bg-[var(--color-surface-2)]"
                style={{ color: l.id === value ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: l.id === value ? 'var(--color-primary)' : 'var(--color-border-strong)' }} />
                {l.label}
              </button>
            ))}
            <p className="px-2 py-1 text-[9px] leading-3" style={{ color: 'var(--color-text-tertiary)' }}>
              Работает у моделей с рассуждением. Для остальных параметр не отправляется.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function PresetToggle({ preset, onChange }: { preset: PermissionPreset; onChange: (p: PermissionPreset) => void }) {
  const presets: { id: PermissionPreset; label: string; icon: React.ReactNode; title: string }[] = [
    { id: 'dfa', label: 'DFA', icon: <ShieldAlert size={10} />, title: 'DFA — спрашивает разрешения (как раньше)' },
    { id: 'fa', label: 'FA', icon: <ShieldCheck size={10} />, title: 'FA — делает без вопросов, кроме установщиков (.exe/.msi)' },
    { id: 'ask', label: 'ASK', icon: <Shield size={10} />, title: 'ASK — только ищет и читает, ничего не создаёт' },
  ];
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg p-0.5" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }} title={presets.find(p => p.id === preset)?.title}>
      {presets.map(p => (
        <button key={p.id} title={p.title} onClick={() => onChange(p.id)}
          className={`flex items-center gap-1 rounded-[7px] px-1.5 py-1 text-[10px] font-bold transition-colors ${preset === p.id ? '' : 'opacity-50 hover:opacity-80'}`}
          style={preset === p.id ? { background: 'var(--color-primary)', color: 'var(--color-primary-text)' } : { color: 'var(--color-text-secondary)' }}>
          {p.icon} {p.label}
        </button>
      ))}
    </div>
  );
}

function ChatBubble({ m, onContinue, streaming, onInstalled }: { m: ChatMessage; onContinue?: () => void; streaming?: boolean; onInstalled?: (text: string) => void }) {
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
  if (m.summary) {
    // Выжимка сжатой истории: её видит и пользователь, и модель, но она не
    // учитывается в расходе контекста — поэтому показывается отдельным
    // блоком, а не обычной репликой агента.
    return <SummaryBlock content={m.content} />;
  }
  if (m.role === 'tool') {
    return <ToolMsg name={m.toolName ?? m.content.slice(0, 40)} content={m.content} error={m.error} cards={m.cards} changes={m.changes} onInstalled={onInstalled} />;
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
  const [open, setOpen] = useState(false);
  const isImg = a.type.startsWith('image/') && !!a.dataUrl;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
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
        ? <img src={a.dataUrl} alt="" className="h-8 w-8 shrink-0 cursor-zoom-in rounded-lg object-cover"
            onClick={() => setOpen(true)} />
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
      {open && isImg && (
        <span
          className="fixed inset-0 z-[70] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={() => setOpen(false)}>
          <span onClick={e => e.stopPropagation()}>
            <img src={a.dataUrl} alt={a.name} className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain"
              style={{ boxShadow: '0 24px 80px rgba(0,0,0,.6)' }} />
          </span>
        </span>
      )}
    </div>
  );
}

function CurrentModelPicker() {
  const cfg = useOpenCoreStore(s => s.config);
  const setActiveModel = useOpenCoreStore(s => s.setActiveModel);
  const setModelsMenuOpen = useOpenCoreStore(s => s.setModelsMenuOpen);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'models' | 'web'>('models');

  const providers = activeProviders(cfg).filter(p => isProviderEnabled(p, cfg));
  const activeProvider = providers.find(p => p.id === cfg.activeProviderId) ?? firstConnectedProvider(cfg);
  if (!activeProvider) return null;

  const models = activeProvider.models.filter(m => isModelEnabled(activeProvider, m.id, cfg));
  const currentIsAvailable = models.some(m => m.id === cfg.activeModelId);
  const webLinks = [...BROWSER_LINKS, ...(cfg.browserBookmarks ?? [])];

  return (
    <div className="relative shrink-0">
      <button onClick={() => { setOpen(o => !o); setTab('models'); }} title="Выбор модели и браузерные ИИ"
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
            className="absolute bottom-full right-0 z-50 mb-2 w-64 rounded-lg border p-1.5"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>
            <div className="px-2 pt-1.5 flex items-center justify-between">
              <button onClick={() => setTab('models')} className="rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-wider transition-colors"
                style={{ color: tab === 'models' ? 'var(--color-primary)' : 'var(--color-text-tertiary)', background: tab === 'models' ? 'var(--color-surface-2)' : 'transparent' }}>
                Модели
              </button>
              <button onClick={() => setTab('web')} className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-wider transition-colors"
                style={{ color: tab === 'web' ? 'var(--color-primary)' : 'var(--color-text-tertiary)', background: tab === 'web' ? 'var(--color-surface-2)' : 'transparent' }}>
                <Globe size={10} /> ИИ в браузере
              </button>
              <button onClick={() => setOpen(false)} title="Свернуть"
                className="flex h-5 w-5 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-surface-2)]"
                style={{ color: 'var(--color-text-tertiary)' }}>
                <ChevronDown size={12} className="rotate-180" />
              </button>
            </div>

            {tab === 'models' ? (
              <>
                <p className="px-2 py-1 pt-2 text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>{activeProvider.name}</p>
                <div className="max-h-44 overflow-y-auto">
                  {models.map(m => (
                    <button key={m.id} onClick={() => setActiveModel(activeProvider.id, m.id)}
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
              </>
            ) : (
              <>
                <p className="px-2 py-1 pt-2 text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                  Браузерные ИИ ({webLinks.length}) — открываются кликом
                </p>
                <div className="max-h-48 overflow-y-auto pb-1">
                  {webLinks.map(b => (
                    <button key={b.url} onClick={() => void invoke('open_url', { url: b.url }).catch(() => window.open(b.url, '_blank'))}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--color-surface-2)]">
                      <Globe size={11} className="shrink-0" style={{ color: 'var(--color-primary)' }} />
                      <span className="min-w-0 flex-1 truncate font-semibold" style={{ color: 'var(--color-text)' }}>{b.name}</span>
                      <ExternalLink size={10} className="shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                    </button>
                  ))}
                </div>
                <button onClick={() => { setOpen(false); setModelsMenuOpen(true); }}
                  className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-1.5 text-[10px] font-bold transition-colors hover:opacity-80"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  <Plus size={11} /> Добавить свою закладку
                </button>
              </>
            )}
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

  // init() нигде не вызывался: из-за этого layout оставался undefined, в
  // системный промпт попадал блок с пустой «Папка:», и агент не знал, где его
  // песочница. Отсюда были относительные пути и пустая папка Projects.
  useEffect(() => { void useOpenCoreStore.getState().init(); }, []);

  const [input, setInput] = useState('');
  const [sessionFilter, setSessionFilter] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // Чаты группируются по свежести — длинный список перестаёт быть стеной.
  const sessionGroups = useMemo(() => {
    const query = sessionFilter.trim().toLowerCase();
    const visible = query ? sessions.filter(s => s.title.toLowerCase().includes(query)) : sessions;
    const day = 86_400_000;
    const now = Date.now();
    const buckets: { label: string; items: SessionMeta[] }[] = [
      { label: 'Сегодня', items: [] },
      { label: 'Вчера', items: [] },
      { label: 'Раньше', items: [] },
    ];
    for (const s of visible) {
      const age = now - s.updated;
      if (age < day) buckets[0].items.push(s);
      else if (age < day * 2) buckets[1].items.push(s);
      else buckets[2].items.push(s);
    }
    return buckets.filter(b => b.items.length > 0);
  }, [sessions, sessionFilter]);

  const abortRefs = useRef<Record<string, AbortController>>({});
  const interruptsRef = useRef<{ sessionId: string; msg: ChatMessage }[]>([]);
  /** Троттлинг сохранения промежуточного прогресса агента на диск (не чаще раза в 1.5 с). */
  const saveThrottle = useRef(0);
  const saveProgress = useCallback((sessionId?: string) => {
    const now = Date.now();
    if (now - saveThrottle.current < 1500) return;
    saveThrottle.current = now;
    void persistSession(sessionId);
  }, [persistSession]);
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
    const preset = useOpenCoreStore.getState().config.permissionPreset ?? 'dfa';
    if (preset === 'ask') return 'deny';
    if (preset === 'fa') {
      if (!req.hazard) return 'always';
      // Установщик (.exe/.msi) даже в FA уточняем у пользователя.
      return new Promise<'allow' | 'deny' | 'always' | 'never'>(resolve => {
        useOpenCoreStore.setState({ pendingPermission: { ...req, resolve } });
      });
    }
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
    const older = all.filter(m => !m.summary).slice(0, all.length - keep.length);
    const transcript = older
      .map(m => `${m.role === 'user' ? 'ПОЛЬЗОВАТЕЛЬ' : m.role === 'assistant' ? 'АГЕНТ' : 'ИНСТРУМЕНТ'}: ${m.content}`)
      .join('\n\n')
      .slice(0, 80_000);
    const ep = resolveEndpoint(activePt.id, modelId, cfgNow.providers, cfgNow.modelContexts);
    ep.serviceTokens = cfgNow.serviceTokens ?? {};
    const notice: ChatMessage = { id: `sys-${Date.now()}`, role: 'assistant', content: 'Сжимаю историю…', timestamp: Date.now() };
    st.appendMessages([notice]);
    st.setSessionRunning(sid, true);
    try {
      const outcome = await callProvider(
        ep,
        'Ты сжимаешь длинную переписку пользователя и агента в ПОДРОБНУЮ, но компактную выжимку, которая полностью заменит оригинал. Составь разделы:\n' +
          '## Цель — коротко, что просил пользователь.\n' +
          '## Что сделано — по пунктам: файлы и пути, установленные моды (с id и именами), выполненные шаги, результаты.\n' +
          '## Информация — точные факты, версии, ссылки, значения.\n' +
          '## Решения — выборы, которые нельзя забывать.\n' +
          '## Открытые задачи — что осталось, что делать дальше.\n' +
          'Пиши на языке переписки, сохрани важные детали (имена, пути, id, версии, решения). Ответь ТОЛЬКО текстом выжимки, инструменты не вызывай.',
        [{ role: 'user', content: transcript }],
      );
      const summary = (outcome.text || '').trim() || '(модель не вернула текст выжимки)';
      const summaryMsg: ChatMessage = {
        id: `summary-${Date.now()}`, role: 'assistant',
        content: `**Сжатая история** (${older.length} сообщений свёрнуто)\n\n${summary}`,
        timestamp: Date.now(),
        summary: true,
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
    if (!text) return;
    if (!isOverride) setInput('');

    const live = useOpenCoreStore.getState();
    const liveSession = live.currentSessionId;
    const liveRunning = !!liveSession && !!live.runningSessions[liveSession];
    if (liveRunning) {
      // Агент занят текущей задачей: сообщение доставляем сразу — это прерывание,
      // агент подхватит его после текущего шага и продолжит работу над новой задачей.
      if (liveSession) {
        const now = Date.now();
        const userMsg: ChatMessage = {
          id: `user-${now}`, role: 'user', content: text, timestamp: now,
        };
        live.appendSessionMessages(liveSession, [userMsg]);
        interruptsRef.current.push({ sessionId: liveSession, msg: userMsg });
      }
      if (!isOverride) setAttachments([]);
      return;
    }

    // Команды "/"
    let taskDirective: string | undefined;
    if (text.startsWith('/')) {
      const cmd = text.split(/\s+/)[0].toLowerCase();
      const arg = text.slice(cmd.length).trim();
      if (runCommandLine(text)) return;
      if (cmd === '/continue') {
        const sid = useOpenCoreStore.getState().currentSessionId;
        const msgs = sid ? useOpenCoreStore.getState().readSessionMessages(sid) : [];
        const lastUser = [...msgs].reverse().find(m => m.role === 'user' && m.id.startsWith('user-'));
        if (!lastUser) {
          const m: ChatMessage = { id: `sys-${Date.now()}`, role: 'assistant', content: 'Нет прерванного запроса — история пуста.', timestamp: Date.now() };
          useOpenCoreStore.getState().appendMessages([m]);
          return;
        }
        void send(lastUser.content);
        return;
      }
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
        const skill = store.skills.find(s => s.name && `/${s.name.toLowerCase()}` === cmd);
        if (skill) {
          taskDirective = `Ты запущен навыком «${skill.name}». Обязательно сначала прочитай его инструкции (read_text root=portal, путь Skills/${skill.name}/SKILL.md) и строго следуй им: ${arg || 'выполни задачу по описанию навыка'}.`;
          text = arg ? `Выполни задачу навыка «${skill.name}»: ${arg}` : `Выполни задачу согласно навыку «${skill.name}».`;
        } else {
          const unknown: ChatMessage = { id: `sys-${Date.now()}`, role: 'assistant', content: `Неизвестная команда **${cmd}**. Набери /help`, timestamp: Date.now() };
          useOpenCoreStore.getState().appendMessages([unknown]);
          return;
        }
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

    // Вложения зашиваем в текст: картинки анализируем по пикселям (палитра) через
    // op_image_inspect, текстовые файлы встраиваем, остальные — упоминание. base64
    // модели НЕ передаём (иначе провайдер zen возвращал HTTP 500 и чат ломался).
    let finalText = text;
    if (attachments.length > 0) {
      const parts: string[] = [];
      for (const a of attachments) {
        const b64 = a.base64 ?? (a.dataUrl ? a.dataUrl.split(',')[1] ?? '' : '');
        if (a.type?.startsWith('image/') && b64) {
          try {
            const imgName = await invoke<string>('op_save_image', { b64 });
            const insp = await invoke<{
              width: number; height: number; alpha: boolean;
              colors: { hex: string; share: number; brightness: number }[];
              dominant: string; average: string;
            }>('op_image_inspect', { root: 'portal', path: `${layout?.cache ?? ''}\\images\\${imgName}` });
            const palette = (Array.isArray(insp?.colors) ? insp.colors : [])
              .map(c => `${c.hex} ${Math.round((c.share ?? 0) * 10) / 10}%`)
              .slice(0, 6).join(', ');
            parts.push(`[Вложение — изображение «${a.name}»] ${insp?.width ?? '?'}×${insp?.height ?? '?'} px, прозрачность: ${insp?.alpha ? 'есть' : 'нет'}, доминирующий цвет ${insp?.dominant || '—'}, средний цвет ${insp?.average || '—'}, палитра: ${palette || '—'}.`);
          } catch {
            parts.push(`[Вложение — изображение «${a.name}»] (не удалось проанализировать)`);
          }
        } else if (a.type?.startsWith('text/') && b64 && b64.length < 70_000) {
          try {
            parts.push(`[Вложение — файл «${a.name}»]\n\`\`\`\n${b64ToUtf8(b64).slice(0, 50_000)}\n\`\`\``);
          } catch {
            parts.push(`[Вложение — файл «${a.name}»] (${fmtSize(a.size)}, ${a.type || 'бинарный'})`);
          }
        } else {
          parts.push(`[Вложение — файл «${a.name}»] (${fmtSize(a.size)}, ${a.type || 'бинарный'})`);
        }
      }
      if (parts.length > 0) finalText = `${text}\n\n${parts.join('\n\n')}`;
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`, role: 'user', content: finalText, attachments: attachments.length ? attachments : undefined, timestamp: Date.now(),
    };
    useOpenCoreStore.getState().appendSessionMessages(runSessionId, [userMsg]);
    setAttachments([]);

    const mode: 'build' | 'plan' = taskDirective ? 'build' : cfg.mode;
    const ep = resolveEndpoint(providerId, modelId, cfgNow.providers, cfgNow.modelContexts);
    ep.serviceTokens = useOpenCoreStore.getState().config.serviceTokens ?? {};
    ep.onSetToken = (host, token) => useOpenCoreStore.getState().setServiceToken(host, token);
    ep.imageGenProvider = cfgNow.imageGenProvider ?? 'stable_horde';

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
      ? `Игрок (Minecraft-ник): ${user?.username || 'игрок'}\nРабочая область агента: ${workspaceLabel}${workspaceZone === 'launcher' ? ' (сборка)' : ''}\nПапка: ${workspaceDir}\nПрава: ${workspaceZone === 'launcher' ? 'чтение лаунчера везде; запись — в папку PortalLauncher, включая папку сборки и settings.json' : 'полный доступ внутри OpenPortal Projects'}${workspaceZone === 'portal' ? `\nПЕСОЧНИЦА: это твоя рабочая папка. Относительные пути (например src/main/java/Mod.java, notes.md, assets/pack.png) считаются от неё — создавай проекты прямо здесь, отдельной папкой на проект (например shader-optics/, my-mod/). Вложенные папки создаются автоматически, можешь писать сразу вглубь. Всё, что ты здесь создаёшь и скачиваешь, сохраняется и доступно в следующих сессиях.` : ''}\nВременная (Temp): ${layout.temp}\nКаталог лаунчера: ${layout.launcher}\nПортал (OpenPortal): ${layout.base}\nАктивная модель: ${modelId} (${ep.provider.name}).`
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
      // Без модели/окна контекста промпт был одинаков для всех моделей —
      // агент не знал свой бюджет и одинаково пытался удерживать историю.
      model: ep.model.id,
      contextLimit: contextWindow(ep.model, ep.provider.id),
    });

    const abort = new AbortController();
    abortRefs.current[runSessionId] = abort;
    useOpenCoreStore.getState().setSessionRunning(runSessionId, true);

    const ctxLimit = contextWindow(ep.model, providerId);
    if (runSessionId === useOpenCoreStore.getState().currentSessionId) useOpenCoreStore.getState().setContextLimit(ctxLimit);

    try {
      const currentMsgs = useOpenCoreStore.getState().readSessionMessages(runSessionId);
      const history = compressHistory(currentMsgs, 36);
      const preset = cfgNow.permissionPreset ?? 'dfa';
      await runAgentTurn({
        ep,
        systemPrompt,
        input: history,
        mode,
        contextLimit: ctxLimit,
        effort: cfgNow.effort,
        requestPermission,
        policy: preset === 'ask' ? 'ask' : undefined,
        interrupt: async () => {
          const q = interruptsRef.current;
          const i = q.findIndex(x => x.sessionId === runSessionId);
          if (i < 0) return null;
          const [item] = q.splice(i, 1);
          return item.msg;
        },
        signal: abort.signal,
        // Сохраняем ход работы на диск по ходу turn'а (с троттлингом), чтобы при
        // закрытии лаунчера частично выполненный запрос не пропадал.
        onAppend: msgs => {
          useOpenCoreStore.getState().appendSessionMessages(runSessionId, msgs);
          saveProgress(runSessionId);
        },
        onUpdate: (id, patch) => {
          useOpenCoreStore.getState().updateSessionMessage(runSessionId, id, patch);
          saveProgress(runSessionId);
        },
        onReplace: msgs => {
          useOpenCoreStore.getState().replaceSessionMessages(runSessionId, msgs);
          saveProgress(runSessionId);
        },
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
      interruptsRef.current = interruptsRef.current.filter(x => x.sessionId !== runSessionId);
      void persistSession(runSessionId);
      // Навыки и сборки могла создать сама модель — обнови списки, чтобы они появились сразу.
      void useOpenCoreStore.getState().refreshSkills();
      void (async () => {
        try {
          const insts = await invoke<any[]>('op_list_instances');
          useInstanceStore.getState().syncFromBackend(insts);
        } catch { /* не критично */ }
      })();
    }
  }, [input, running, store, cfg, layout, attachments, requestPermission, user?.username, compressChat, persistSession, saveProgress]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  const cmdOpen = !running && input.startsWith('/');
  const cmdQuery = input.slice(1).toLowerCase();
  const allCommands = [
    ...COMMANDS,
    ...store.skills.filter(s => s.name).map(s => ({ cmd: `/${s.name}`, desc: s.description || 'Навык', instant: false as const })),
  ];
  const cmdList = cmdOpen ? allCommands.filter(c => c.cmd.slice(1).toLowerCase().includes(cmdQuery)) : [];
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
      <aside className="flex w-64 shrink-0 flex-col border-r" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="flex items-center gap-2.5 px-3.5 pt-3.5 pb-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[11px] font-black"
            style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>OP</div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[13px] font-black leading-4" style={{ color: 'var(--color-text)' }}>OpenPortal</h2>
            <p className="truncate text-[10px] leading-3" style={{ color: 'var(--color-text-tertiary)' }}>
              {sessions.length > 0 ? `${sessions.length} ${plural(sessions.length, 'чат', 'чата', 'чатов')}` : 'История пуста'}
            </p>
          </div>
          <button onClick={() => void store.newSession()} title="Новый чат"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--color-surface-2)]"
            style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
            <Plus size={14} />
          </button>
        </div>
        <div className="px-3 pb-2">
          <div className="flex items-center gap-1.5 rounded px-2 py-1.5"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
            <Search size={12} className="shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
            <input
              value={sessionFilter}
              onChange={e => setSessionFilter(e.target.value)}
              placeholder="Поиск по чатам"
              className="min-w-0 flex-1 bg-transparent text-[11px] outline-none"
              style={{ color: 'var(--color-text)' }}
            />
            {sessionFilter && (
              <button onClick={() => setSessionFilter('')} title="Очистить" style={{ color: 'var(--color-text-tertiary)' }}>
                <X size={11} />
              </button>
            )}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
          {sessionGroups.map(group => (
            <div key={group.label} className="mb-1">
              <p className="px-2 py-1 text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>{group.label}</p>
              {group.items.map(s => {
                const active = s.id === currentSessionId;
                return (
                  <button key={s.id} onClick={() => void store.openSession(s.id)}
                    className="group relative flex w-full items-center gap-2 rounded py-2 pl-2.5 pr-1.5 text-left transition-colors hover:bg-[var(--color-surface-2)]"
                    style={active ? { background: 'var(--color-surface-2)' } : undefined}>
                    {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full" style={{ background: 'var(--color-primary)' }} />}
                    {runningSessions[s.id]
                      ? <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-[var(--color-primary)] border-t-transparent" />
                      : <MessageSquare size={12} className="shrink-0" style={{ color: active ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }} />}
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-4" style={{ color: active ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>{s.title}</span>
                    <span className="hidden shrink-0 group-hover:inline-block" onClick={e => { e.stopPropagation(); void store.deleteSession(s.id); }}>
                      <Trash2 size={11} style={{ color: 'var(--color-text-tertiary)' }} />
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="px-2.5 py-3 text-[11px] leading-5" style={{ color: 'var(--color-text-tertiary)' }}>Чатов пока нет. Нажми «+», чтобы начать новую сессию.</p>
          )}
          {sessions.length > 0 && sessionGroups.length === 0 && (
            <p className="px-2.5 py-3 text-[11px] leading-5" style={{ color: 'var(--color-text-tertiary)' }}>Ничего не найдено по запросу «{sessionFilter}».</p>
          )}
        </div>
        <div className="border-t p-2" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={() => navigate('/home')}
            className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-[12px] font-bold transition-colors hover:bg-[var(--color-surface-2)]"
            style={{ color: 'var(--color-text-secondary)' }}>
            <ChevronLeft size={13} /> В лаунчер
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
            className="flex items-center gap-1.5 text-[10px] font-bold"
            title={running ? 'Агент выполняет задачу' : 'Агент свободен'}
            style={{ color: running ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>
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
            <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-5 py-8">
              <div className="flex flex-col gap-2">
                <h1 className="text-xl font-black" style={{ color: 'var(--color-text)' }}>С чем помочь?</h1>
                <p className="max-w-xl text-[13px] leading-6" style={{ color: 'var(--color-text-secondary)' }}>
                  Агент работает с файлами и сборками лаунчера, ищет контент на Modrinth и ставит его прямо в сборку.
                  Выбери направление — подставится готовая команда.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {START_TOPICS.map(topic => (
                  <button
                    key={topic.title}
                    onClick={() => { setInput(topic.prompt); composerRef.current?.focus(); }}
                    className="group flex items-start gap-3 rounded-lg p-3 text-left transition-colors hover:bg-[var(--color-surface-2)]"
                    style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded" style={{ background: 'var(--color-surface-2)', color: topic.color }}>
                      {topic.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-bold" style={{ color: 'var(--color-text)' }}>{topic.title}</span>
                      <span className="mt-0.5 block text-[11px] leading-4" style={{ color: 'var(--color-text-tertiary)' }}>{topic.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] leading-5" style={{ color: 'var(--color-text-tertiary)' }}>
                Режим <b style={{ color: 'var(--color-text-secondary)' }}>Build</b> выполняет задачи, <b style={{ color: 'var(--color-text-secondary)' }}>Plan</b> только планирует.
                Команды — <code className="font-mono" style={{ color: 'var(--color-primary)' }}>/help</code>
              </p>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              {messages.map(m => (
                <ChatBubble key={m.id} m={m} streaming={running && m.id === lastAssistantId}
                  onContinue={m.id === lastAssistantId && !running
                    ? () => void send('Продолжи ровно с того места, где ты остановился. Не повторяй уже написанное и не начинай заново — просто продолжи.')
                    : undefined}
                  onInstalled={text => void send(text)} />
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

        <div className="ore-plain relative shrink-0 border-t p-3" style={{ borderColor: 'var(--color-border)' }}>
          {cmdOpen && cmdList.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 z-30 mx-auto mb-2 w-full max-w-3xl overflow-hidden rounded-lg border p-1"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>
              {cmdList.map(c => (
                <button key={c.cmd} onClick={() => {
                  if (c.instant) { setInput(''); if (!runCommandLine(c.cmd)) void send(c.cmd); }
                  else setInput(`${c.cmd} `);
                }}
                  className="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-2)]">
                  <span className="shrink-0 font-mono text-[11px] font-bold" style={{ color: 'var(--color-primary)' }}>{c.cmd}</span>
                  <span className="truncate text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{c.desc}</span>
                  {!c.instant && <span className="ml-auto shrink-0 text-[9px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>+ описание</span>}
                </button>
              ))}
            </div>
          )}
          {/* Композер собран в один контейнер: тулбар, поле ввода и кнопки
              больше не висят тремя отдельными плавающими рядами. */}
          {/* Без overflow-hidden: контейнер обрезал выпадающий список модели и
              панель управления моделями, из-за чего они не открывались. */}
          <div className="mx-auto w-full max-w-3xl rounded-lg"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b p-2" style={{ borderColor: 'var(--color-border)' }}>
                {attachments.map((a, i) => (
                  <AttachmentChip key={i} a={a} onRemove={() => setAttachments(prev => prev.filter((_, j) => j !== i))} />
                ))}
              </div>
            )}
            {/* overflow-x-auto здесь обрезал бы выпадающий список модели,
                поэтому строка тулбара не имеет overflow — модели могут
                вылезать вверх поверх поля ввода. */}
            <div className="flex items-center gap-1.5 border-b px-2 py-1.5" style={{ borderColor: 'var(--color-border)' }}>
              <ModeToggle mode={cfg.mode} onChange={m => useOpenCoreStore.getState().setMode(m)} />
              <CurrentModelPicker />
              <ContextMeter onCompact={() => void compressChat()} />
              <EffortPicker value={cfg.effort ?? 'medium'} onChange={v => useOpenCoreStore.getState().updateConfig({ effort: v })} />
              <PresetToggle preset={cfg.permissionPreset ?? 'dfa'} onChange={p => useOpenCoreStore.getState().setPermissionPreset(p)} />
            </div>
            <div className="flex items-end gap-1.5 p-1.5">
              <input type="file" id="op-file" className="hidden" onChange={onFilePicked} />
              <label htmlFor="op-file" title="Прикрепить файл или картинку"
                className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded transition-colors hover:bg-[var(--color-surface)]"
                style={{ border: '1px dashed var(--color-border)', color: 'var(--color-text-tertiary)' }}>
                <Plus size={14} />
              </label>
              <textarea
                ref={composerRef}
                value={input}
                onChange={e => { setInput(e.target.value); }}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder={running ? 'Агент занят — отправь сообщение, он продолжит после текущего шага' : 'Что сделать?  (/ — команды)'}
                className="max-h-40 min-h-9 flex-1 resize-none overflow-y-auto bg-transparent px-2.5 py-1.5 text-[13px] leading-6 outline-none"
                style={{ color: 'var(--color-text)' }}
              />
              {running ? (
                <button onClick={() => { if (currentSessionId) abortRefs.current[currentSessionId]?.abort(); }} title="Остановить"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded"
                  style={{ background: 'var(--color-surface)', color: 'var(--color-error)', border: '1px solid var(--color-border)' }}>
                  <StopCircle size={15} />
                </button>
              ) : (
                <button onClick={() => void send()} title="Отправить" disabled={!input.trim()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded transition-opacity disabled:opacity-40"
                  style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
                  <Send size={14} />
                </button>
              )}
            </div>
          </div>
          <p className="mt-1.5 text-center text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            Агент может ошибаться — проверяй важные изменения. Файлы и ключи хранятся локально в папке OpenPortal.
          </p>
        </div>
      </main>

      <ModelManager />
      <PermissionModal />
    </div>
  );
}