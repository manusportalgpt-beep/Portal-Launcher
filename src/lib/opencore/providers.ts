/**
 * Реестр провайдеров OpenPortal.
 * Endpoint'ы и форматы соответствуют https://opencode.ai/docs/providers/.
 *
 * kind:
 *   openai    — OpenAI-совместимый chat/completions (подавляющее большинство)
 *   anthropic — Anthropic Messages API
 *   zen       — OpenCode Zen: адрес выбирается по семейству модели (family)
 *               openai→/v1/chat/completions, anthropic→/v1/messages
 */

export type ProviderKind = 'openai' | 'anthropic' | 'zen';

export interface ModelDef {
  id: string;
  name?: string;
  reasoning?: boolean;
  free?: boolean;
  /** Для zen: family — влияние на выбор ендпоинта. */
  family?: 'openai' | 'anthropic' | 'google' | 'responses';
  /** vision: модель умеет читать изображения. */
  vision?: boolean;
  /** Размер контекстного окна в токенах (для индикатора контекста). */
  contextLength?: number;
}

export interface ProviderDef {
  id: string;
  name: string;
  kind: ProviderKind;
  /** Базовый адрес (без /chat/completions и /v1/messages). */
  baseUrl: string;
  apiKeyHint?: string;
  /** Кликабельная ссылка «Получить ключ» (открывается в браузере). */
  keyUrl?: string;
  docs?: string;
  /** По умолчанию список моделей загружается из реестра; пусто — надо у провайдера. */
  models: ModelDef[];
  supportsFree?: boolean;
}

/** URL листинга моделей провайдера (GET). Zen и Anthropic — /v1/models, остальные — /models. */
export function modelsListUrl(p: ProviderDef, baseUrl: string): string {
  const base = (baseUrl || p.baseUrl).replace(/\/+$/, '');
  if (p.kind === 'zen') return `${base}/v1/models`;
  return p.kind === 'anthropic' ? `${base}/v1/models` : `${base}/models`;
}

/** Размер контекстного окна модели в токенах с дефолтами по семейству/провайдеру. */
export function contextWindow(model: ModelDef, providerId?: string): number {
  if (model.contextLength) return model.contextLength;
  if (model.family === 'anthropic') return 200_000;
  if (model.family === 'google' || providerId === 'google') return 1_000_000;
  return 128_000;
}

export const OP_PROVIDERS: ProviderDef[] = [
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    kind: 'zen',
    baseUrl: 'https://opencode.ai/zen',
    apiKeyHint: 'Новый ключ (oc_sk_...) — со страницы https://opencode.ai/auth (оплата, потом free-модели бесплатно)',
    keyUrl: 'https://opencode.ai/auth',
    docs: 'https://opencode.ai/docs/providers/#opencode-zen',
    supportsFree: true,
    models: [
      { id: 'big-pickle', name: 'Big Pickle', family: 'openai', free: true, contextLength: 200_000 },
      { id: 'deepseek-v4-pro', family: 'openai', reasoning: true },
      { id: 'kimi-k3', family: 'openai', reasoning: true },
      { id: 'minimax-m3', family: 'openai' },
      { id: 'glm-5.3', family: 'openai' },
      { id: 'qwen3-coder', family: 'openai', reasoning: true },
      { id: 'claude-sonnet-5', family: 'anthropic', reasoning: true, vision: true, contextLength: 200_000 },
      { id: 'claude-opus-4.5', family: 'anthropic', reasoning: true, vision: true, contextLength: 200_000 },
      { id: 'deepseek-v4-flash-free', family: 'openai', free: true },
      { id: 'muse-spark-1.3-contributor-free', family: 'openai', free: true },
      { id: 'muse-spark-1.2-contributor-free', family: 'openai', free: true },
      { id: 'mimo-v2.5-free', family: 'openai', free: true },
      { id: 'ling-3.0-flash-fin-free', family: 'openai', free: true },
      { id: 'nemotron-3-ultra-free', family: 'openai', free: true },
      { id: 'nemotron-3.5-lightning-free', family: 'openai', free: true },
    ],
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    kind: 'openai',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    apiKeyHint: 'Ключ со страницы https://opencode.ai/zen (подписка Go)',
    keyUrl: 'https://opencode.ai/auth',
    docs: 'https://opencode.ai/docs/providers/#opencode-go',
    models: [
      { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', reasoning: true, vision: true },
      { id: 'grok-4.6', name: 'Grok 4.6', reasoning: true },
      { id: 'kimi-k3', name: 'Kimi K3', reasoning: true },
      { id: 'minimax-m3', name: 'MiniMax M3', reasoning: true },
      { id: 'glm-5.3', name: 'GLM-5.3', reasoning: true },
      { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
      { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash' },
      { id: 'muse-spark-1.3-contributor', name: 'Muse Spark 1.3 Contributor' },
      { id: 'omen-alpha', name: 'Omen Alpha', reasoning: true },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyHint: 'sk-... из platform.openai.com',
    models: [
      { id: 'gpt-5.3', reasoning: true, vision: true, contextLength: 400_000 },
      { id: 'gpt-5.2', reasoning: true, vision: true, contextLength: 400_000 },
      { id: 'gpt-5.1', reasoning: true, vision: true, contextLength: 400_000 },
      { id: 'gpt-5', reasoning: true, vision: true, contextLength: 400_000 },
      { id: 'gpt-5-mini', reasoning: true, contextLength: 200_000 },
      { id: 'gpt-5-nano', contextLength: 200_000 },
      { id: 'gpt-4.1', vision: true, contextLength: 1_000_000 },
      { id: 'o4-mini', reasoning: true, vision: true, contextLength: 200_000 },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKeyHint: 'sk-ant-... из console.anthropic.com (Claude Pro/Max или API-ключ)',
    docs: 'https://opencode.ai/docs/providers/#anthropic',
    models: [
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', reasoning: true, vision: true, contextLength: 200_000 },
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', reasoning: true, vision: true, contextLength: 200_000 },
      { id: 'claude-haiku-4-20250514', name: 'Claude Haiku 4', vision: true, contextLength: 200_000 },
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', reasoning: true, vision: true, contextLength: 200_000 },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyHint: 'sk-or-... из openrouter.ai/settings/keys',
    docs: 'https://opencode.ai/docs/providers/#openrouter',
    supportsFree: true,
    models: [
      { id: 'moonshotai/kimi-k2', name: 'Kimi K2', reasoning: true, vision: true, contextLength: 128_000 },
      { id: 'openai/gpt-5.2', name: 'GPT-5.2', reasoning: true, vision: true, contextLength: 400_000 },
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', reasoning: true, vision: true, contextLength: 200_000 },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', reasoning: true, contextLength: 128_000 },
      { id: 'deepseek/deepseek-reasoner', name: 'DeepSeek R1', reasoning: true, contextLength: 128_000 },
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', reasoning: true, vision: true, contextLength: 1_000_000 },
      { id: 'qwen/qwen3-235b-a22b', name: 'Qwen3 235B', vision: true, contextLength: 256_000 },
      { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick', vision: true, contextLength: 1_000_000 },
      { id: 'openrouter/auto', name: 'OpenRouter Auto', vision: true, contextLength: 200_000 },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    kind: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyHint: 'AIza... из Google AI Studio (aistudio.google.com/apikey)',
    models: [
      { id: 'gemini-3.5-pro', reasoning: true, vision: true, contextLength: 1_000_000 },
      { id: 'gemini-3.5-flash', reasoning: true, vision: true, contextLength: 1_000_000 },
      { id: 'gemini-2.5-pro', reasoning: true, vision: true, contextLength: 1_000_000 },
      { id: 'gemini-2.5-flash', reasoning: true, vision: true, contextLength: 1_000_000 },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyHint: 'gsk_... из console.groq.com',
    docs: 'https://opencode.ai/docs/providers/#groq',
    models: [
      { id: 'qwen3-coder-480b', name: 'Qwen3 Coder 480B', reasoning: true },
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
      { id: 'gemma3-27b-it', name: 'Gemma 3 27B', vision: true },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyHint: 'sk-... из platform.deepseek.com',
    docs: 'https://opencode.ai/docs/providers/#deepseek',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V4' },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1', reasoning: true },
    ],
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    apiKeyHint: 'xai-... из console.x.ai',
    models: [
      { id: 'grok-4', name: 'Grok 4', reasoning: true, vision: true },
      { id: 'grok-4-fast', name: 'Grok 4 Fast', reasoning: true },
      { id: 'grok-4-fast-reasoning', name: 'Grok 4 Fast Reasoning', reasoning: true },
    ],
  },
  {
    id: 'together',
    name: 'Together AI',
    kind: 'openai',
    baseUrl: 'https://api.together.ai/v1',
    apiKeyHint: 'См. api.together.ai',
    models: [
      { id: 'moonshotai/Kimi-K2-Instruct', name: 'Kimi K2', reasoning: true },
      { id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct', name: 'Qwen3 Coder 480B', reasoning: true },
    ],
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    kind: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKeyHint: 'См. inference.cerebras.ai',
    models: [{ id: 'qwen3-coder-480b', name: 'Qwen3 Coder 480B', reasoning: true }],
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    kind: 'openai',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    apiKeyHint: 'См. app.fireworks.ai',
    models: [
      { id: 'accounts/fireworks/models/kimi-k2-instruct', name: 'Kimi K2', reasoning: true },
      { id: 'accounts/fireworks/models/qwen3-coder-480b', name: 'Qwen3 Coder 480B', reasoning: true },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama (локально)',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    apiKeyHint: 'Ключ не нужен',
    models: [
      { id: 'qwen3-coder:32b', name: 'Qwen3 Coder' },
      { id: 'qwen3:32b', name: 'Qwen3' },
      { id: 'llama3.3:70b', name: 'Llama 3.3' },
    ],
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (локально)',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    apiKeyHint: 'Ключ не нужен',
    models: [],
  },
];

/** Провайдер, добавленный пользователем (id с префиксом custom:, apiKey хранится в конфиге). */
export type CustomProviderDef = ProviderDef & { custom: true; apiKey?: string };

export const CUSTOM_PROVIDER_PREFIX = 'custom:';

export function customProviderId(name: string): string {
  return `${CUSTOM_PROVIDER_PREFIX}${name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${Date.now().toString(36)}`;
}