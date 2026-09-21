/** Стандартные типы чата и конфигурации OpenPortal. */

export type Role = 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface Attachment {
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  base64?: string;
  url?: string;
}

/** Расход токенов одного запроса к модели. */
export interface TokenUsage {
  input: number;
  output: number;
  total: number;
  /** true — значения оценены приблизительно (провайдер не вернул usage). */
  estimated?: boolean;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: ToolCall[];
  thinking?: string;
  attachments?: Attachment[];
  error?: boolean;
  model?: string;
  timestamp: number;
  /** Расход токенов, если известен. */
  usage?: TokenUsage;
  /** Сжатую историю помечаем, чтобы никогда не выкидывать её из контекста при дальнейшем усечении. */
  summary?: boolean;
}

export interface SessionMeta {
  id: string;
  title: string;
  updated: number;
  message_count: number;
}

export interface SessionData {
  id: string;
  title: string;
  createdAt: number;
  updated: number;
  modelId: string;
  providerId: string;
  mode: 'build' | 'plan';
  /** Последняя рабочая папка сессии (root: portal|temp|launcher + путь). */
  cwd?: { root: string; path: string };
  messages: ChatMessage[];
}

/** Контекст работы агента: без сборки (OpenPortal Projects) или конкретная сборка. */
export type ProjectContext =
  | { kind: 'none' }
  | { kind: 'build'; instanceId: string };

/** Состояние провайдера в конфиге: включён ли он и какие модели активны. */
export interface ProviderState {
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  customName?: string;
  /** карта modelId → включена. Не задано = включены все из реестра. */
  modelStates?: Record<string, boolean>;
  /** Модели, загруженные с API провайдера (перезаписывает реестр в пикере). */
  remoteModels?: { id: string; name?: string; free?: boolean }[];
}

/** Пресет разрешений агента: DFA — спрашивать (как раньше), FA — полный доступ
 *  (без модалки, кроме установщиков .exe/.msi), ASK — только запросы/чтение. */
export type PermissionPreset = 'dfa' | 'fa' | 'ask';

export interface OpenPortalConfig {
  version: number;
  providers: Record<string, ProviderState>;
  activeProviderId: string;
  activeModelId: string;
  mode: 'build' | 'plan';
  /** С какой сборкой (или без) работает агент. */
  project?: ProjectContext;
  /** Последняя рабочая папка (root: portal|temp|launcher + путь). */
  cwd?: { root: string; path: string };
  temperature?: number;
  /** Токены сервисов (API) для инструмента http_request: хост → токен. */
  serviceTokens?: Record<string, string>;
  /** Пресет прав: dfa | fa | ask (по умолчанию dfa). */
  permissionPreset?: PermissionPreset;
  /** Провайдер генерации изображений: stable_horde (по умолчанию, бесплатно, без ключа), novita (по ключу) или pollinations (бесплатно, может ловить 429). */
  imageGenProvider?: 'stable_horde' | 'novita' | 'pollinations';
  /** Пользовательские закладки «Браузерные ИИ» (добавляются к встроенному списку). */
  browserBookmarks?: { name: string; url: string }[];
}

export type PermissionDecision = 'always' | 'never' | 'once';

/** Разрешения: ключ `tool:root` → решение. + «once» живёт в памяти сессии. */
export type PermissionsMap = Record<string, PermissionDecision>;

/** Запрос разрешения для инструмента агента. */
export interface PermissionRequest {
  tool: string;
  root: PortalRoot;
  label: string;
  detail: string;
  cwdLabel: string;
  /** Опасный вызов: запуск/скачивание установщика (.exe/.msi и т.п.) — блокируется даже в FA. */
  hazard?: boolean;
  /** Вызов-разрешитель. */
  resolve: (decision: 'allow' | 'deny' | 'always' | 'never') => void;
}

export interface PortalLayout {
  base: string;
  projects: string;
  sessions: string;
  cache: string;
  config: string;
  temp: string;
  launcher: string;
}

export interface CmdResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  content_type: string;
  text: string;
  error?: string;
}

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export type PortalRoot = 'portal' | 'temp' | 'launcher';

/** Установленный навык агента: `OpenPortal/Skills/<slug>/SKILL.md`. */
export interface SkillMeta {
  name: string;
  path: string;
  description: string;
}