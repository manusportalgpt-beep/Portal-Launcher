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
  PortalLayout,
  PortalRoot,
  ProjectContext,
  ChatMessage,
  SkillMeta,
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
    providers: {},
    activeProviderId: 'openrouter',
    activeModelId: 'moonshotai/kimi-k2',
    mode: 'build',
    project: { kind: 'none' },
    temperature: 0.4,
  };
}

export interface PermissionRequest {
  tool: string;
  root: PortalRoot;
  label: string;
  detail: string;
  cwdLabel: string;
  /** Вызов-разрешитель. */
  resolve: (decision: 'allow' | 'deny' | 'always' | 'never') => void;
}

interface OpenCoreState {
  layout: PortalLayout | null;
  config: OpenPortalConfig;
  permissions: PermissionsMap;
  sessions: SessionMeta[];
  currentSessionId: string | null;
  messages: ChatMessage[];
  running: boolean;
  pendingPermission: PermissionRequest | null;
  modelsMenuOpen: boolean;
  loading: boolean;
  /** Установленные навыки агента (SKILL.md). */
  skills: SkillMeta[];

  init: () => Promise<void>;
  updateConfig: (patch: Partial<OpenPortalConfig>) => void;
  toggleProvider: (providerId: string, enabled: boolean) => void;
  toggleModel: (providerId: string, modelId: string, enabled: boolean) => void;
  setProviderApiKey: (providerId: string, apiKey: string) => void;
  setProviderBaseUrl: (providerId: string, baseUrl: string) => void;
  setActiveModel: (providerId: string, modelId: string) => void;
  setMode: (mode: 'build' | 'plan') => void;
  setProject: (project: ProjectContext) => void;
  setCwd: (root: PortalRoot, path: string) => void;

  resolvePermission: (decision: 'allow' | 'deny' | 'always' | 'never') => void;
  setPermissionsMap: (map: PermissionsMap) => void;

  newSession: () => Promise<void>;
  openSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  appendMessages: (msgs: ChatMessage[]) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  setRunning: (running: boolean) => void;
  setModelsMenuOpen: (open: boolean) => void;
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
      running: false,
      pendingPermission: null,
      modelsMenuOpen: false,
      loading: true,
      skills: [],

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

      resolvePermission(decision) {
        const req = get().pendingPermission;
        if (!req) return;
        if (decision === 'always' || decision === 'never') {
          const key = `${req.tool}:${req.root}`;
          const next = { ...get().permissions, [key]: decision };
          set({ permissions: next });
          void persistPermissions(next);
        }
        req.resolve(decision);
        set({ pendingPermission: null });
      },

      setPermissionsMap(map) {
        set({ permissions: map });
        void persistPermissions(map);
      },

      async newSession() {
        const cfg = get().config;
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
        set({ sessions: [meta, ...get().sessions], currentSessionId: id, messages: [] });
      },

      async openSession(id) {
        try {
          const raw = await invoke<string>('op_load_session', { sessionId: id });
          const data = JSON.parse(raw) as SessionData;
          set({
            currentSessionId: id,
            messages: data.messages ?? [],
            config: {
              ...get().config,
              activeProviderId: data.providerId || get().config.activeProviderId,
              activeModelId: data.modelId || get().config.activeModelId,
              mode: data.mode || get().config.mode,
              cwd: data.cwd ?? get().config.cwd,
            },
          });
        } catch (e) {
          console.error('[OpenPortal] open session failed', e);
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

      setRunning(running) {
        set({ running });
      },

      setModelsMenuOpen(open) {
        set({ modelsMenuOpen: open });
      },
    }),
);

/** Провайдеры для UI: реестр + кастомные из конфига (если добавлены). */
export function activeProviders(config: OpenPortalConfig): ProviderDef[] {
  const list: ProviderDef[] = [...OP_PROVIDERS];
  for (const [id, st] of Object.entries(config.providers)) {
    if (id.startsWith(CUSTOM_PROVIDER_PREFIX)) {
      list.push({
        id,
        name: st.customName || 'Custom',
        kind: st.baseUrl?.includes('anthropic') ? 'anthropic' : 'openai',
        baseUrl: st.baseUrl || '',
        apiKeyHint: '',
        models: Object.keys(st.modelStates ?? {}).map(mid => ({ id: mid })),
      });
    }
  }
  return list;
}

/** Разрешён ли провайдер: отсутствие состояния = включён (оптимальный дефолт). */
export function isProviderEnabled(pt: ProviderDef, config: OpenPortalConfig): boolean {
  const st = config.providers[pt.id];
  return st ? (st.enabled ?? true) : true;
}

/** Включена ли модель: отсутствие состояния = включена. */
export function isModelEnabled(pt: ProviderDef, mid: string, config: OpenPortalConfig): boolean {
  const st = config.providers[pt.id];
  if (!st || !st.modelStates) return true;
  return st.modelStates[mid] ?? true;
}