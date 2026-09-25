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
  /** Публичный ключ-по-умолчанию (встроен в приложение). Не сохраняется в конфиг,
   *  в UI показывается замаскированным; свой ключ пользователя перекрывает его. */
  defaultApiKey?: string;
}

/** URL листинга моделей провайдера (GET). Zen и Anthropic — /v1/models, остальные — /models. */
export function modelsListUrl(p: ProviderDef, baseUrl: string): string {
  const base = (baseUrl || p.baseUrl).replace(/\/+$/, '');
  if (p.kind === 'zen') return `${base}/v1/models`;
  return p.kind === 'anthropic' ? `${base}/v1/models` : `${base}/models`;
}

/**
 * Известные размеры контекста для моделей, чей провайдер их не сообщает.
 *
 * OpenCode Zen возвращает в /v1/models только id/object/created/owned_by —
 * поля context_length там нет, поэтому без такой таблицы все модели Zen
 * показывались с дефолтом 128K, хотя у части из них миллион токенов.
 *
 * Здесь только те значения, которые известны точно. Для остальных моделей
 * размер можно задать вручную в панели моделей — он сохраняется и
 * используется дальше.
 */
const KNOWN_MODEL_CONTEXTS: Record<string, number> = {
  'space-bunny-free': 1_048_576,
};

/** Линейка моделей space-bunny: подтверждённый контекст 1M у -free варианта. */
const KNOWN_PREFIX_CONTEXTS: [RegExp, number][] = [
  [/^space-bunny/i, 1_048_576],
];

/** Размер контекстного окна модели в токенах с дефолтами по семейству/провайдеру. */
export function contextWindow(model: ModelDef, providerId?: string): number {
  if (model.contextLength) return model.contextLength;
  // Точное значение из локальной таблицы (для zen и других, кто молчит).
  const known = KNOWN_MODEL_CONTEXTS[model.id];
  if (known) return known;
  for (const [pattern, value] of KNOWN_PREFIX_CONTEXTS) {
    if (pattern.test(model.id)) return value;
  }
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
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultApiKey: 'sk-3071c287d3b8462fb32bc25fc582639e',
    apiKeyHint: 'Встроен публичный ключ (скрыт: в конфиг не сохраняется). Он может поймать 402 — тогда введи свой ключ с platform.deepseek.com.',
    keyUrl: 'https://platform.deepseek.com',
    docs: 'https://api-docs.deepseek.com',
    supportsFree: true,
    models: [
      { id: 'deepseek-flash', name: 'DeepSeek Flash', free: true },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', reasoning: true },
    ],
  },
  {
    id: 'freebuff',
    name: 'FreeBuff (бесплатно)',
    kind: 'openai',
    baseUrl: 'https://freebuff.llm.pm/v1',
    apiKeyHint: 'Сначала попробуй без ключа: модель может отвечать анонимно. Если сервис просит авторизацию: открой https://freebuff.llm.pm/v1, нажми «Generate Login URL», авторизуйся и скопируй выданный токен в это поле.',
    keyUrl: 'https://freebuff.llm.pm/v1',
    docs: 'https://freebuff.com',
    supportsFree: true,
    models: [
      { id: 'kimi-k2.6', name: 'Kimi K2.6', reasoning: true, contextLength: 200_000 },
      { id: 'deepseek-v4', name: 'DeepSeek V4', reasoning: true },
      { id: 'mimo-v2.5-pro', name: 'MiMo v2.5 Pro', reasoning: true },
      { id: 'minimax-m2.7', name: 'MiniMax M2.7' },
      { id: 'gemini-flash', name: 'Gemini Flash', vision: true },
    ],
  },
  {
    id: 'novita',
    name: 'Novita AI',
    kind: 'openai',
    baseUrl: 'https://api.novita.ai/v3/openai',
    apiKeyHint: 'Ключ из Novita (novita.ai → API Key). Тот же ключ используется для генерации изображений.',
    keyUrl: 'https://novita.ai/settings/key-management',
    docs: 'https://docs.novita.ai',
    supportsFree: true,
    models: [
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', reasoning: true },
      { id: 'deepseek/deepseek-v3.1', name: 'DeepSeek V3.1', reasoning: true },
      { id: 'qwen/qwen3-coder-480b', name: 'Qwen3 Coder 480B', reasoning: true },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
      { id: 'sao10k/l3.1-8b-chaotic-neutron', name: 'Chaotic Neutron 8B', free: true },
    ],
  },
  {
    id: 'alibaba',
    name: 'Alibaba (DashScope)',
    kind: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyHint: 'sk-... из DashScope (bailian.console.aliyun.com)',
    keyUrl: 'https://bailian.console.aliyun.com',
    docs: 'https://help.aliyun.com/zh/model-studio',
    models: [
      { id: 'qwen3-max', name: 'Qwen3 Max', reasoning: true, contextLength: 262_144 },
      { id: 'qwen3-plus', name: 'Qwen3 Plus', contextLength: 262_144 },
      { id: 'qwen3-turbo', name: 'Qwen3 Turbo' },
      { id: 'qwen2.5-coder-32b-instruct', name: 'Qwen2.5 Coder 32B', reasoning: true },
      { id: 'qwen-vl-max', name: 'Qwen VL Max', vision: true },
    ],
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    kind: 'openai',
    baseUrl: 'https://api.githubcopilot.com',
    apiKeyHint: 'GitHub-токен (github.com/settings/tokens → Generate new token, класс. PAT с scope copilot, или OAuth-токен). Приложение само обменяет его на временный Copilot JWT.',
    keyUrl: 'https://github.com/settings/tokens',
    docs: 'https://docs.github.com/en/copilot',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', vision: true, contextLength: 128_000 },
      { id: 'gpt-4.1', name: 'GPT-4.1', vision: true, contextLength: 1_000_000 },
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', reasoning: true, vision: true, contextLength: 200_000 },
      { id: 'claude-haiku-4', name: 'Claude Haiku 4', vision: true, contextLength: 200_000 },
    ],
  },
  {
    id: 'vercel',
    name: 'Vercel AI Gateway',
    kind: 'openai',
    baseUrl: 'https://gateway.vercel.ai/v1',
    apiKeyHint: 'Ключ из Vercel (vercel.com → AI Gateway). Модели подгружаются с API.',
    keyUrl: 'https://vercel.com',
    docs: 'https://vercel.com/docs/ai',
    models: [],
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyHint: 'Ключ из console.mistral.ai (API Keys)',
    keyUrl: 'https://console.mistral.ai/api-keys/',
    docs: 'https://docs.mistral.ai',
    models: [
      { id: 'codestral-latest', name: 'Codestral', reasoning: true, contextLength: 256_000 },
      { id: 'mistral-large-latest', name: 'Mistral Large', reasoning: true, contextLength: 128_000 },
      { id: 'mistral-medium-latest', name: 'Mistral Medium' },
      { id: 'ministral-3b-latest', name: 'Ministral 3B' },
    ],
  },
  {
    id: 'cohere',
    name: 'Cohere',
    kind: 'openai',
    baseUrl: 'https://api.cohere.com/v1',
    apiKeyHint: 'Ключ из dashboard.cohere.com',
    keyUrl: 'https://dashboard.cohere.com',
    docs: 'https://docs.cohere.com',
    models: [
      { id: 'command-a-03-2025', name: 'Command A', reasoning: true, contextLength: 256_000 },
      { id: 'command-r-plus-08-2024', name: 'Command R+' },
      { id: 'command-r-08-2024', name: 'Command R' },
    ],
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    kind: 'openai',
    baseUrl: 'https://api.perplexity.ai',
    apiKeyHint: 'Ключ из perplexity.ai/settings/api',
    keyUrl: 'https://www.perplexity.ai/settings/api',
    docs: 'https://docs.perplexity.ai',
    models: [
      { id: 'sonar-pro', name: 'Sonar Pro', reasoning: true, contextLength: 200_000 },
      { id: 'sonar', name: 'Sonar', contextLength: 200_000 },
    ],
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    kind: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1',
    apiKeyHint: 'Ключ из platform.moonshot.ai',
    keyUrl: 'https://platform.moonshot.ai',
    docs: 'https://platform.moonshot.ai/docs',
    models: [
      { id: 'kimi-k2', name: 'Kimi K2', reasoning: true, vision: true, contextLength: 128_000 },
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 128K' },
      { id: 'moonshot-v1-32k', name: 'Moonshot v1 32K' },
    ],
  },
  {
    id: 'zhipu',
    name: 'Zhipu (GLM / BigModel)',
    kind: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyHint: 'Ключ из BigModel (bigmodel.cn)',
    keyUrl: 'https://bigmodel.cn',
    docs: 'https://docs.bigmodel.cn',
    models: [
      { id: 'glm-4.7', name: 'GLM-4.7', reasoning: true, vision: true, contextLength: 128_000 },
      { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', reasoning: true, free: true, contextLength: 128_000 },
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    kind: 'openai',
    baseUrl: 'https://api.minimax.io/v1',
    apiKeyHint: 'Ключ из platform.minimaxi.com',
    keyUrl: 'https://platform.minimaxi.com',
    docs: 'https://platform.minimaxi.com/document/why%20minimax',
    models: [
      { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', reasoning: true, contextLength: 200_000 },
      { id: 'MiniMax-M1', name: 'MiniMax M1', reasoning: true },
    ],
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    kind: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKeyHint: 'Ключ из build.nvidia.com (получить ключ бесплатно)',
    keyUrl: 'https://build.nvidia.com',
    docs: 'https://docs.api.nvidia.com/nim',
    supportsFree: true,
    models: [
      { id: 'deepseek-r1', name: 'DeepSeek R1', reasoning: true },
      { id: 'qwen2.5-coder-32b-instruct', name: 'Qwen2.5 Coder 32B' },
      { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
    ],
  },
  {
    id: 'sambanova',
    name: 'SambaNova',
    kind: 'openai',
    baseUrl: 'https://api.sambanova.ai/v1',
    apiKeyHint: 'Ключ из cloud.sambanova.ai (бесплатные fast-модели)',
    keyUrl: 'https://cloud.sambanova.ai',
    docs: 'https://docs.sambanova.ai',
    supportsFree: true,
    models: [
      { id: 'DeepSeek-R1', name: 'DeepSeek R1', reasoning: true },
      { id: 'QwQ-32B', name: 'QwQ 32B', reasoning: true },
      { id: 'Meta-Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B' },
    ],
  },
];

/** Провайдер, добавленный пользователем (id с префиксом custom:, apiKey хранится в конфиге). */
export type CustomProviderDef = ProviderDef & { custom: true; apiKey?: string };

export const CUSTOM_PROVIDER_PREFIX = 'custom:';

export function customProviderId(name: string): string {
  return `${CUSTOM_PROVIDER_PREFIX}${name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${Date.now().toString(36)}`;
}

/** Закладки «Браузерные ИИ»: клик — открытие в браузере (без ключей, логин на месте). */
export interface BrowserLink { name: string; url: string }

export const BROWSER_LINKS: BrowserLink[] = [
  { name: 'ChatGPT', url: 'https://chatgpt.com' },
  { name: 'Claude', url: 'https://claude.ai' },
  { name: 'Gemini', url: 'https://gemini.google.com' },
  { name: 'DeepSeek Chat', url: 'https://chat.deepseek.com' },
  { name: 'Perplexity', url: 'https://www.perplexity.ai' },
  { name: 'Grok', url: 'https://grok.com' },
  { name: 'Microsoft Copilot', url: 'https://copilot.microsoft.com' },
  { name: 'Qwen Chat', url: 'https://chat.qwen.ai' },
  { name: 'Le Chat (Mistral)', url: 'https://chat.mistral.ai' },
  { name: 'Meta AI (Llama)', url: 'https://www.meta.ai' },
  { name: 'HuggingChat', url: 'https://huggingface.co/chat' },
  { name: 'Kimi', url: 'https://kimi.com' },
  { name: 'MiniMax Hailuo', url: 'https://www.hailuo.ai' },
  { name: 'GLM (智谱清言)', url: 'https://chatglm.cn' },
  { name: 'You.com', url: 'https://you.com' },
  { name: 'Poe', url: 'https://poe.com' },
  { name: 'Pi', url: 'https://pi.ai' },
  { name: 'DuckDuckGo AI Chat', url: 'https://duckduckgo.com/?aiChat=1' },
  { name: 'NVIDIA ChatRTX', url: 'https://www.nvidia.com/en-us/ai-data-science/products/chatrtx/' },
  { name: 'OpenRouter', url: 'https://openrouter.ai' },
];

/** Строка для системного промпта агента: список браузерных ИИ (кликабельные ссылки). */
export function browserLinksHint(): string {
  return BROWSER_LINKS.map(b => `- [${b.name}](${b.url})`).join('\n');
}