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
  cwd?: string;
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
}

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
}

export type PermissionDecision = 'always' | 'never' | 'once';

/** Разрешения: ключ `tool:root` → решение. + «once» живёт в памяти сессии. */
export type PermissionsMap = Record<string, PermissionDecision>;

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