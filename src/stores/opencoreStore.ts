import { create } from 'zustand';
import { invoke } from '@/lib/invoke-shim';
import {
  OP_PROVIDERS,
  CUSTOM_PROVIDER_PREFIX,
  type ProviderDef,
} from '@/lib/opencore/providers';
import type {
  OpenPortalConfig,
  SessionData,
  SessionMeta,
  PermissionsMap,
  PermissionRequest,
  PortalLayout,
  PortalRoot,
  ProjectContext,
  ChatMessage,
  SkillMeta,
  TokenUsage,
} from '@/lib/opencore/types';

const CONFIG_VERSION = 1;

/** Читает/пишет конфиг на диск (Rust). Фолбэк на localStorage. */
async function readDiskConfig(): Promise<OpenPortalConfig> {
  try {
    const raw = await invoke<string>('op_load_config');
    if (!raw || raw === '{}') return defaultConfig();
    const parsed = JSON.parse(raw) as OpenPortalConfig;
    return { ...defaultConfig(), ...parsed, providers: { ...defaultConfig().providers, ...parsed.providers } };
  } catch {
    return defaultConfig();
  }
}

function defaultConfig(): OpenPortalConfig {
  return {
    version: CONFIG_VERSION,
    providers: { 'opencode-zen': { enabled: true } },
    activeProviderId: 'opencode-zen',
    activeModelId: 'big-pickle',
    mode: 'build',
    project: { kind: 'none' },
    temperature: 0.4,
  };
}

interface OpenCoreState {
  layout: PortalLayout | null;
  config: OpenPortalConfig;
  permissions: PermissionsMap;
  sessions: SessionMeta[];
  currentSessionId: string | null;
  messages: ChatMessage[];
  pendingPermission: PermissionRequest | null;
  modelsMenuOpen: boolean;
  loading: boolean;
  /** Установленные навыки агента (SKILL.md). */
  skills: SkillMeta[];
  /** Расход токенов сессии: суммарно + размер последнего контекста. */
  usage: { input: number; output: number; context: number; limit: number; estimated: boolean };

  init: () => Promise<void>;
  updateConfig: (patch: Partial<OpenPortalConfig>) => void;
  toggleProvider: (providerId: string, enabled: boolean) => void;
  toggleModel: (providerId: string, modelId: string, enabled: boolean) => void;
  setProviderApiKey: (providerId: string, apiKey: string) => void;
  setProviderBaseUrl: (providerId: string, baseUrl: string) => void;
  setProviderModels: (providerId: string, models: { id: string; name?: string; free?: boolean }[]) => void;
  setActiveModel: (providerId: string, modelId: string) => void;
  setMode: (mode: 'build' | 'plan') => void;
  setProject: (project: ProjectContext) => void;
  setCwd: (root: PortalRoot, path: string) => void;
  setServiceToken: (host: string, token: string) => void;

  resolvePermission: (decision: 'allow' | 'deny' | 'always' | 'never' | 'once') => void;
  setPermissionsMap: (map: PermissionsMap) => void;

  /** Сессии, в которых прямо сейчас работает агент (фоновые задачи не мешают открывать другие чаты). */
  runningSessions: Record<string, boolean>;
  /** Сообщения фоновых (не открытых сейчас) сессий. */
  backgroundMessages: Record<string, ChatMessage[]>;

  newSession: () => Promise<void>;
  openSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  appendMessages: (msgs: ChatMessage[]) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  /** Мгновенные сообщения для конкретной сессии (текущей или фоновой). */
  appendSessionMessages: (sessionId: string, msgs: ChatMessage[]) => void;
  /** Правка сообщения в конкретной сессии (текущей или фоновой). */
  updateSessionMessage: (sessionId: string, id: string, patch: Partial<ChatMessage>) => void;
  /** Сообщения сессии без её открытия. */
  readSessionMessages: (sessionId: string) => ChatMessage[];
  setSessionRunning: (sessionId: string, running: boolean) => void;
  setModelsMenuOpen: (open: boolean) => void;
  addUsage: (u: TokenUsage) => void;
  setContextLimit: (limit: number) => void;
  resetUsage: () => void;
}

async function persistConfig(cfg: OpenPortalConfig) {
  try {
    await invoke('op_save_config', { payload: JSON.stringify(cfg) });
  } catch (e) {
    console.error('[OpenPortal] config persist failed', e);
  }
}

async function persistPermissions(map: PermissionsMap) {
  try {
    await invoke('op_save_permissions', { payload: JSON.stringify(map) });
  } catch (e) {
    console.error('[OpenPortal] permissions persist failed', e);
  }
}

export const useOpenCoreStore = create<OpenCoreState>()((set, get) => ({
      layout: null,
      config: defaultConfig(),
      permissions: {},
      sessions: [],
      currentSessionId: null,
      messages: [],
      runningSessions: {},
      backgroundMessages: {},
      pendingPermission: null,
      modelsMenuOpen: false,
      loading: true,
      skills: [],
      usage: { input: 0, output: 0, context: 0, limit: 0, estimated: false },

      async init() {
        try {
          const layout = await invoke<PortalLayout>('op_layout');
          set({ layout });
        } catch {
          /* не критично */
        }
        const cfg = await readDiskConfig();
        let permissions: PermissionsMap = {};
        try {
          const raw = await invoke<string>('op_load_permissions');
          if (raw && raw !== '{}') permissions = JSON.parse(raw);
        } catch { /* пусто */ }
        let sessions: SessionMeta[] = [];
        try {
          sessions = await invoke<SessionMeta[]>('op_list_sessions');
        } catch { /* пусто */ }
        let skills: SkillMeta[] = [];
        try {
          skills = await invoke<SkillMeta[]>('op_list_skills');
        } catch { /* пусто */ }
        set({ config: cfg, permissions, sessions, skills, loading: false });
        // Автоматически открыть самую свежую сессию.
        if (sessions.length > 0) {
          await get().openSession(sessions[0].id);
        }
      },

      updateConfig(patch) {
        const next = { ...get().config, ...patch };
        set({ config: next });
        void persistConfig(next);
      },

      toggleProvider(providerId, enabled) {
        const cfg = get().config;
        const prev = cfg.providers[providerId] ?? {};
        const next = {
          ...cfg,
          providers: { ...cfg.providers, [providerId]: { ...prev, enabled } },
        };
        set({ config: next });
        void persistConfig(next);
      },

      toggleModel(providerId, modelId, enabled) {
        const cfg = get().config;
        const prev = cfg.providers[providerId] ?? {};
        const modelStates = { ...(prev.modelStates ?? {}) };
        modelStates[modelId] = enabled;
        const next = {
          ...cfg,
          providers: { ...cfg.providers, [providerId]: { ...prev, modelStates } },
        };
        set({ config: next });
        void persistConfig(next);
      },

      setProviderApiKey(providerId, apiKey) {
        const cfg = get().config;
        const prev = cfg.providers[providerId] ?? {};
        const next = {
          ...cfg,
          providers: { ...cfg.providers, [providerId]: { ...prev, apiKey } },
        };
        set({ config: next });
        void persistConfig(next);
      },

      setProviderBaseUrl(providerId, baseUrl) {
        const cfg = get().config;
        const prev = cfg.providers[providerId] ?? {};
        const next = {
          ...cfg,
          providers: { ...cfg.providers, [providerId]: { ...prev, baseUrl } },
        };
        set({ config: next });
        void persistConfig(next);
      },

      setProviderModels(providerId, models) {
        const cfg = get().config;
        const prev = cfg.providers[providerId] ?? {};
        const next = {
          ...cfg,
          providers: { ...cfg.providers, [providerId]: { ...prev, remoteModels: models } },
        };
        set({ config: next });
        void persistConfig(next);
      },

      setActiveModel(providerId, modelId) {
        const cfg = get().config;
        const prev = cfg.providers[providerId] ?? {};
        const next = {
          ...cfg,
          activeProviderId: providerId,
          activeModelId: modelId,
          providers: { ...cfg.providers, [providerId]: { ...prev, enabled: true } },
        };
        set({ config: next });
        void persistConfig(next);
      },

      setMode(mode) {
        get().updateConfig({ mode });
      },

      setProject(project) {
        get().updateConfig({ project });
        // Сообщаем бэкенду активную сборку (для песочницы записи).
        void invoke('op_set_active_build', {
          instanceId: project.kind === 'build' ? project.instanceId : null,
        }).catch(() => {});
      },

      setCwd(root, path) {
        get().updateConfig({ cwd: { root, path } });
      },

      setServiceToken(host, token) {
        const cfg = get().config;
        const next = {
          ...cfg,
          serviceTokens: { ...(cfg.serviceTokens ?? {}), [host]: token.trim() },
        };
        set({ config: next });
        void persistConfig(next);
      },

      resolvePermission(decision) {
        const req = get().pendingPermission;
        if (!req) return;
        if (decision === 'always' || decision === 'never') {
          const key = `${req.tool}:${req.root}`;
          const next = { ...get().permissions, [key]: decision };
          set({ permissions: next });
          void persistPermissions(next);
        }
        // 'once' эквивалентен 'allow', но не сохраняется в разрешения.
        req.resolve(decision === 'once' ? 'allow' : decision);
        set({ pendingPermission: null });
      },

      setPermissionsMap(map) {
        set({ permissions: map });
        void persistPermissions(map);
      },

      async newSession() {
        // Не плодим пустые сессии: если текущий чат ещё пуст — переиспользуем его.
        if (get().currentSessionId && get().messages.length === 0) {
          set({ messages: [] });
          get().resetUsage();
          return;
        }
        const cfg = get().config;
        const prev = get().currentSessionId;
        // Сохраняем сообщения текущей сессии как фоновые (там может идти активная задача).
        const background = prev ? { ...get().backgroundMessages, [prev]: get().messages } : get().backgroundMessages;
        const id = crypto.randomUUID();
        const now = Date.now();
        const session: SessionData = {
          id,
          title: 'Новая сессия',
          createdAt: now,
          updated: now,
          modelId: cfg.activeModelId,
          providerId: cfg.activeProviderId,
          mode: cfg.mode,
          cwd: cfg.cwd ?? { root: 'portal', path: '' },
          messages: [],
        };
        await invoke('op_save_session', { sessionId: id, payload: JSON.stringify(session) });
        const meta: SessionMeta = { id, title: session.title, updated: now, message_count: 0 };
        set({ backgroundMessages: background, sessions: [meta, ...get().sessions], currentSessionId: id, messages: [] });
        get().resetUsage();
      },

      async openSession(id) {
        if (id === get().currentSessionId) return;
        const prev = get().currentSessionId;
        // Перед переключением сохраняем текущие сообщения как фоновые, чтобы активная задача не потерялась.
        const background = prev ? { ...get().backgroundMessages, [prev]: get().messages } : get().backgroundMessages;
        try {
          const raw = await invoke<string>('op_load_session', { sessionId: id });
          const data = JSON.parse(raw) as SessionData;
          set({
            backgroundMessages: background,
            currentSessionId: id,
            messages: background[id] ?? data.messages ?? [],
            config: {
              ...get().config,
              activeProviderId: data.providerId || get().config.activeProviderId,
              activeModelId: data.modelId || get().config.activeModelId,
              mode: data.mode || get().config.mode,
              cwd: data.cwd ?? get().config.cwd,
            },
          });
          get().resetUsage();
        } catch (e) {
          console.error('[OpenPortal] open session failed', e);
          set({ backgroundMessages: background });
        }
      },

      async deleteSession(id) {
        try {
          await invoke('op_delete_session', { sessionId: id });
        } catch (e) {
          console.error('[OpenPortal] delete session failed', e);
        }
        const sessions = get().sessions.filter(s => s.id !== id);
        set({ sessions });
        if (get().currentSessionId === id) {
          if (sessions.length > 0) {
            await get().openSession(sessions[0].id);
          } else {
            await get().newSession();
          }
        }
      },

      appendMessages(msgs) {
        set({ messages: [...get().messages, ...msgs] });
      },

      updateMessage(id, patch) {
        set({ messages: get().messages.map(m => (m.id === id ? { ...m, ...patch } : m)) });
      },

      appendSessionMessages(sessionId, msgs) {
        if (sessionId === get().currentSessionId) {
          set({ messages: [...get().messages, ...msgs] });
          return;
        }
        const list = get().backgroundMessages[sessionId] ?? [];
        set({ backgroundMessages: { ...get().backgroundMessages, [sessionId]: [...list, ...msgs] } });
      },

      updateSessionMessage(sessionId, id, patch) {
        if (sessionId === get().currentSessionId) {
          set({ messages: get().messages.map(m => (m.id === id ? { ...m, ...patch } : m)) });
          return;
        }
        const list = (get().backgroundMessages[sessionId] ?? []).map(m => (m.id === id ? { ...m, ...patch } : m));
        set({ backgroundMessages: { ...get().backgroundMessages, [sessionId]: list } });
      },

      readSessionMessages(sessionId) {
        return sessionId === get().currentSessionId ? get().messages : (get().backgroundMessages[sessionId] ?? []);
      },

      setSessionRunning(sessionId, running) {
        const next = { ...get().runningSessions };
        if (running) next[sessionId] = true;
        else delete next[sessionId];
        set({ runningSessions: next });
      },

      setModelsMenuOpen(open) {
        set({ modelsMenuOpen: open });
      },

      addUsage(u) {
        const cur = get().usage;
        set({
          usage: {
            ...cur,
            input: cur.input + (u.input || 0),
            output: cur.output + (u.output || 0),
            context: u.input || cur.context,
            estimated: !!u.estimated,
          },
        });
      },

      setContextLimit(limit) {
        set({ usage: { ...get().usage, limit } });
      },

      resetUsage() {
        set({ usage: { input: 0, output: 0, context: 0, limit: get().usage.limit, estimated: false } });
      },
    }),
);

/** Провайдеры для UI: реестр + кастомные из конфига (если добавлены). Модели мержатся с загруженными из API. */
export function activeProviders(config: OpenPortalConfig): ProviderDef[] {
  const list: ProviderDef[] = OP_PROVIDERS.map(p => {
    const st = config.providers[p.id];
    if (!st?.remoteModels || st.remoteModels.length === 0) return p;
    const registry = new Map(p.models.map(m => [m.id, m]));
    const merged = st.remoteModels.map(m => {
      const cur = registry.get(m.id);
      return cur ? { ...m, ...cur, free: m.free || cur.free, name: cur.name ?? m.name } : m;
    });
    return { ...p, models: merged };
  });
  for (const [id, st] of Object.entries(config.providers)) {
    if (id.startsWith(CUSTOM_PROVIDER_PREFIX)) {
      const remote = st.remoteModels ?? [];
      list.push({
        id,
        name: st.customName || 'Custom',
        kind: st.baseUrl?.includes('anthropic') ? 'anthropic' : 'openai',
        baseUrl: st.baseUrl || '',
        apiKeyHint: '',
        models: remote.length > 0 ? remote : Object.keys(st.modelStates ?? {}).map(mid => ({ id: mid })),
      });
    }
  }
  return list;
}

/** Разрешён ли провайдер: по умолчанию подключён только OpenCode Zen (бесплатный). */
export function isProviderEnabled(pt: ProviderDef, config: OpenPortalConfig): boolean {
  const st = config.providers[pt.id];
  return st ? (st.enabled ?? true) : pt.id === 'opencode-zen';
}

/** Первый подключённый провайдер (с хоть одной моделью) — фолбэк для send() и пикера. */
export function firstConnectedProvider(config: OpenPortalConfig): ProviderDef | undefined {
  return activeProviders(config).find(p => isProviderEnabled(p, config) && p.models.length > 0);
}

/** Включена ли модель: отсутствие состояния = включена. */
export function isModelEnabled(pt: ProviderDef, mid: string, config: OpenPortalConfig): boolean {
  const st = config.providers[pt.id];
  if (!st || !st.modelStates) return true;
  return st.modelStates[mid] ?? true;
}