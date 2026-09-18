import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, MessageSquare, Trash2, Sparkles, Send, StopCircle, ChevronDown, ChevronRight,
  Settings2, Bot, Hammer, DraftingCompass, Braces, ChevronLeft, Paperclip, Boxes, Check,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@/lib/invoke-shim';
import { useOpenCoreStore, activeProviders, isProviderEnabled, isModelEnabled, firstConnectedProvider } from '@/stores/opencoreStore';
import { useInstanceStore } from '@/stores/instanceStore';
import { toIconSrc } from '@/lib/icon-src';
import { resolveEndpoint, runAgentTurn, buildSystemPrompt, compressHistory } from '@/lib/opencore/agent';
import { Markdown } from '@/components/openportal/Markdown';
import { ModelManager } from '@/components/openportal/ModelManager';
import { PermissionModal } from '@/components/openportal/PermissionModal';
import type { ChatMessage, SessionData, PermissionRequest, Attachment, ProjectContext } from '@/lib/opencore/types';

const HELP_TEXT = [
  '**Команды OpenPortal:**',
  '- `/help` — список команд',
  '- `/models` — выбрать модели',
  '- `/skill-creator <описание>` — агент создаст новый навык',
  '- `/skill-installer <имя/ссылка>` — агент найдёт и установит навык',
  '',
  'Полное описание — в чате: попроси, и агент сам выполнит.',
].join('\n');

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
    <div className="mb-1.5 overflow-hidden rounded-lg border px-2.5 py-1.5" style={{ borderColor: 'var(--color-border)', background: 'rgba(127,127,127,0.08)' }}>
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

function ModeToggle({ mode, onChange }: { mode: 'build' | 'plan'; onChange: (m: 'build' | 'plan') => void }) {
  return (
    <div className="flex shrink-0 rounded-xl p-0.5" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
      <button onClick={() => onChange('build')}
        className={`flex items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[11px] font-bold transition-colors ${mode === 'build' ? '' : 'opacity-50 hover:opacity-80'}`}
        style={mode === 'build'
          ? { background: 'var(--color-primary)', color: 'var(--color-primary-text)' }
          : { color: 'var(--color-text-secondary)' }}>
        <Hammer size={12} /> Build
      </button>
      <button onClick={() => onChange('plan')}
        className={`flex items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[11px] font-bold transition-colors ${mode === 'plan' ? '' : 'opacity-50 hover:opacity-80'}`}
        style={mode === 'plan'
          ? { background: 'var(--color-primary)', color: 'var(--color-primary-text)' }
          : { color: 'var(--color-text-secondary)' }}>
        <DraftingCompass size={12} /> Plan
      </button>
    </div>
  );
}

function ChatBubble({ m }: { m: ChatMessage }) {
  if (m.role === 'tool') {
    return <ToolMsg name={m.toolName ?? m.content.slice(0, 40)} content={m.content} error={m.error} />;
  }
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-[13px] leading-6"
          style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
          <Markdown text={m.content} />
        </div>
      </div>
    );
  }
  // assistant
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
          <Bot size={11} /> {m.model ? `${m.model}` : 'OpenPortal'}
        </div>
        {m.thinking && <ThinkingBlock text={m.thinking} />}
        {m.content ? (
          <div className="rounded-2xl rounded-bl-md px-3.5 py-2.5" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
            <Markdown text={m.content} />
          </div>
        ) : null}
        {m.error && <p className="mt-1 text-[11px]" style={{ color: 'var(--color-error)' }}>Это сообщение могло быть сгенерировано ошибочно. Проверь контекст и попробуй ещё раз.</p>}
      </div>
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
      <button onClick={() => setOpen(o => !o)}
        className="flex max-w-[220px] items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold"
        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
        <Sparkles size={13} style={{ color: 'var(--color-primary)' }} />
        <span className="truncate">{currentIsAvailable ? cfg.activeModelId : activeProvider.name}</span>
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
            <p className="px-2 py-1.5 text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>{activeProvider.name}</p>
            <div className="max-h-64 overflow-y-auto">
              {models.map(m => (
                <button key={m.id} onClick={() => { setActiveModel(activeProvider.id, m.id); setOpen(false); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-[var(--color-surface-2)]"
                  style={{ color: cfg.activeModelId === m.id ? 'var(--color-primary)' : 'var(--color-text)' }}>
                  <div className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: cfg.activeModelId === m.id ? 'var(--color-primary)' : 'var(--color-border)' }} />
                  <span className="flex-1 truncate font-semibold">{m.name ?? m.id}</span>
                  {m.reasoning && <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>think</span>}
                </button>
              ))}
            </div>
            <button onClick={() => { setOpen(false); setModelsMenuOpen(true); }}
              className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-[11px] font-bold transition-colors hover:opacity-80"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
              <Settings2 size={12} /> Управление моделями
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
  const running = useOpenCoreStore(s => s.running);
  const currentSessionId = useOpenCoreStore(s => s.currentSessionId);
  const cfg = useOpenCoreStore(s => s.config);
  const layout = useOpenCoreStore(s => s.layout);

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const init = useOpenCoreStore(s => s.init);
  useEffect(() => { void init(); }, [init]);

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

  async function persistSession() {
    if (!currentSessionId) return;
    const msgs = useOpenCoreStore.getState().messages;
    const cfgNow = useOpenCoreStore.getState().config;
    const firstUser = msgs.find(m => m.role === 'user');
    const title = firstUser ? firstUser.content.replace(/\s+/g, ' ').slice(0, 60) : 'Новая сессия';
    const data: SessionData = {
      id: currentSessionId,
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
      await invoke('op_save_session', { sessionId: currentSessionId, payload: JSON.stringify(data) });
      // Обновить заголовок в списке
      useOpenCoreStore.setState({
        sessions: useOpenCoreStore.getState().sessions.map(s => s.id === currentSessionId
          ? { ...s, title, updated: data.updated, message_count: msgs.length }
          : s),
      });
    } catch (e) {
      console.error('[OpenPortal] save session failed', e);
    }
  }

  const send = useCallback(async () => {
    let text = input.trim();
    if (!text || running) return;
    setInput('');

    // Команды "/"
    let taskDirective: string | undefined;
    if (text.startsWith('/')) {
      const cmd = text.split(/\s+/)[0].toLowerCase();
      const arg = text.slice(cmd.length).trim();
      if (cmd === '/new') { void store.newSession(); return; }
      if (cmd === '/clear') { useOpenCoreStore.setState({ messages: [] }); return; }
      if (cmd === '/plan' || cmd === '/build') {
        useOpenCoreStore.getState().setMode(cmd === '/plan' ? 'plan' : 'build');
        void store.newSession();
        return;
      }
      if (cmd === '/models') { useOpenCoreStore.getState().setModelsMenuOpen(true); return; }
      if (cmd === '/help') {
        const msg: ChatMessage = { id: `sys-${Date.now()}`, role: 'assistant', content: HELP_TEXT, timestamp: Date.now() };
        useOpenCoreStore.getState().appendMessages([msg]);
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
        useOpenCoreStore.getState().setRunning(false);
        return;
      }
    }

    // Создать сессию при необходимости
    let sessionId = store.currentSessionId;
    if (!sessionId || useOpenCoreStore.getState().messages.length === 0) {
      await store.newSession();
      sessionId = useOpenCoreStore.getState().currentSessionId;
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`, role: 'user', content: text, attachments: attachments.length ? attachments : undefined, timestamp: Date.now(),
    };
    useOpenCoreStore.getState().appendMessages([userMsg]);
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
      ? `Рабочая область агента: ${workspaceLabel}${workspaceZone === 'launcher' ? ' (сборка)' : ''}\nПапка: ${workspaceDir}\nПрава: ${workspaceZone === 'launcher' ? 'чтение лаунчера везде; запись — только в папку сборки и в settings.json' : 'полный доступ внутри OpenPortal Projects'}\nВременная (Temp): ${layout.temp}\nКаталог лаунчера: ${layout.launcher}\nПортал (OpenPortal): ${layout.base}\nАктивная модель: ${modelId} (${ep.provider.name}).`
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
    abortRef.current = abort;
    useOpenCoreStore.getState().setRunning(true);

    try {
      const currentMsgs = useOpenCoreStore.getState().messages;
      const history = compressHistory(currentMsgs, 36);
      await runAgentTurn({
        ep,
        systemPrompt,
        input: history,
        mode,
        requestPermission,
        signal: abort.signal,
        onAppend: msgs => useOpenCoreStore.getState().appendMessages(msgs),
        onUpdate: (id, patch) => useOpenCoreStore.getState().updateMessage(id, patch),
      });
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      const msg: ChatMessage = {
        id: `err-${Date.now()}`, role: 'assistant',
        content: err.startsWith('Отменено') ? 'Задача остановлена вами.' : `Ошибка: ${err}`,
        error: true, timestamp: Date.now(),
      };
      useOpenCoreStore.getState().appendMessages([msg]);
    } finally {
      useOpenCoreStore.getState().setRunning(false);
      void persistSession();
    }
  }, [input, running, store, cfg, layout, attachments, requestPermission]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

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
        <div className="mb-2 flex flex-wrap gap-1.5 px-4">
          <ModeToggle mode={cfg.mode} onChange={m => useOpenCoreStore.getState().setMode(m)} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2 pt-0">
          {sessions.map(s => (
            <button key={s.id} onClick={() => void store.openSession(s.id)}
              className={`group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors ${s.id === currentSessionId ? '' : 'hover:bg-[var(--color-surface-2)]'}`}
              style={s.id === currentSessionId
                ? { background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }
                : { border: '1px solid transparent' }}>
              <MessageSquare size={13} className="shrink-0" style={{ color: s.id === currentSessionId ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }} />
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
        <header className="flex items-center gap-3 border-b px-5 py-3" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <Bot size={15} style={{ color: 'var(--color-primary)' }} />
            <span className="text-xs font-black" style={{ color: 'var(--color-text)' }}>OpenPortal</span>
          </div>
          <div className="flex-1" />
          <BuildPicker />
          <CurrentModelPicker />
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
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
              {messages.map(m => <ChatBubble key={m.id} m={m} />)}
              {running && (
                <div className="flex items-center gap-2 px-1 py-1 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
                  OpenPortal думает…
                </div>
              )}
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="relative border-t p-4" style={{ borderColor: 'var(--color-border)' }}>
          {attachments.length > 0 && (
            <div className="mb-2 flex gap-2">
              {attachments.map((a, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                  {a.type.startsWith('image/') && a.dataUrl
                    ? <img src={a.dataUrl} alt="" className="h-5 w-5 rounded object-cover" />
                    : <Paperclip size={12} className="text-[var(--color-text-tertiary)]" />}
                  <span className="max-w-[120px] truncate font-semibold" style={{ color: 'var(--color-text)' }}>{a.name}</span>
                  <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-error)]">✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <input type="file" id="op-file" className="hidden" onChange={onFilePicked} />
            <label htmlFor="op-file" title="Прикрепить файл/картинку"
              className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl transition-colors hover:bg-[var(--color-surface-2)]"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              <Paperclip size={16} />
            </label>
            <textarea
              value={input}
              onChange={e => { setInput(e.target.value); }}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={running ? 'Агент занят…' : 'Что сделать?  (/ — команды)'}
              className="max-h-40 min-h-10 flex-1 resize-none rounded-2xl px-4 py-2.5 text-[13px] leading-6 outline-none"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            />
            {running ? (
              <button onClick={() => abortRef.current?.abort()} title="Остановить"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--color-error)' }}>
                <StopCircle size={17} />
              </button>
            ) : (
              <button onClick={() => void send()} title="Отправить" disabled={!input.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-opacity disabled:opacity-40"
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