/**
 * Общие настройки AI-провайдеров: пресеты, прокси и список моделей.
 * Используются и в панели PTAgent, и в Настройках — чтобы endpoint
 * и модели менялись одинаково при выборе провайдера.
 */

export interface ProviderPreset {
  id: string;
  name: string;
  endpoint: string;
  models: string[];
  /** Модели с бесплатным тарифом (OpenRouter `:free`) — показываются первыми. */
  freeModels?: string[];
  icon: string;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'openai', name: 'ChatGPT (OpenAI)',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'o3-mini', 'o4-mini', 'gpt-4-turbo'],
    icon: 'AI',
  },
  {
    id: 'openrouter', name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    freeModels: [
      'meta-llama/llama-3.1-8b-instruct:free',
      'meta-llama/llama-3.2-3b-instruct:free',
      'meta-llama/llama-4-scout:free',
      'google/gemini-2.5-flash:free',
      'google/gemini-2.0-flash-exp:free',
      'qwen/qwen3-32b:free',
      'deepseek/deepseek-chat-v3-0324:free',
      'mistralai/mistral-small-3.1-24b-instruct:free',
      'openrouter/auto:free',
    ],
    models: [
      'meta-llama/llama-3.1-8b-instruct:free', 'meta-llama/llama-3.2-3b-instruct:free', 'meta-llama/llama-4-scout:free',
      'google/gemini-2.5-flash:free', 'google/gemini-2.0-flash-exp:free', 'qwen/qwen3-32b:free',
      'deepseek/deepseek-chat-v3-0324:free', 'mistralai/mistral-small-3.1-24b-instruct:free', 'openrouter/auto:free',
      'openai/gpt-4o-mini', 'openai/gpt-4o', 'openai/gpt-4.1', 'openai/gpt-4.1-mini', 'openai/o3-mini', 'openai/o4-mini',
      'anthropic/claude-3.5-sonnet', 'anthropic/claude-3.5-haiku', 'anthropic/claude-sonnet-4', 'anthropic/claude-haiku-4',
      'meta-llama/llama-3.1-70b-instruct', 'meta-llama/llama-3.3-70b-instruct', 'meta-llama/llama-4-maverick',
      'mistralai/mistral-large', 'mistralai/mistral-small', 'mistralai/codestral-2501',
      'qwen/qwen-2.5-72b-instruct', 'qwen/qwen3-32b', 'qwen/qwen3-235b-a22b',
      'google/gemini-2.0-flash', 'google/gemini-2.5-flash', 'google/gemini-2.5-pro',
      'deepseek/deepseek-chat', 'deepseek/deepseek-r1', 'deepseek/deepseek-coder',
      'openai/codex-mini', 'openai/codex',
      'opencode/opencode', 'opencode/opencode-v2', 'opencode/opencode-thinking',
      'zencode/zencode', 'zencode/zen-code', 'grok/grok-2', 'grok/grok-3',
      'nousresearch/hermes-3', 'cohere/command-r', 'x-ai/grok-beta',
    ],
    icon: 'OR',
  },
  {
    id: 'claude', name: 'Claude (Anthropic)',
    endpoint: 'https://api.anthropic.com/v1/messages',
    models: ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022', 'claude-sonnet-4-20250514', 'claude-haiku-4-20250514', 'claude-opus-4-20250514'],
    icon: 'CL',
  },
  {
    id: 'proxy', name: 'Custom / Proxy',
    endpoint: '',
    models: [],
    icon: 'PR',
  },
];

/** Прокси для обхода региональных блокировок (РФ и др.). */
export const PROXY_ENDPOINTS: Record<string, string> = {
  'openai': 'https://api.openai-proxy.org/v1/chat/completions',
  'openrouter': 'https://openrouter.ai/api/v1/chat/completions',
  'claude': 'https://api.anthropic-proxy.org/v1/messages',
};

/** Endpoint, который должен стоять у провайдера с учётом прокси. */
export function endpointFor(providerId: string, useProxy: boolean): string {
  const preset = PROVIDERS.find(p => p.id === providerId);
  if (!preset) return '';
  if (useProxy && PROXY_ENDPOINTS[preset.id]) return PROXY_ENDPOINTS[preset.id];
  return preset.endpoint;
}

/** Модель по умолчанию: первая бесплатная, иначе первая из списка. */
export function defaultModelFor(providerId: string): string {
  const preset = PROVIDERS.find(p => p.id === providerId);
  if (!preset || preset.models.length === 0) return '';
  const free = preset.freeModels?.find(m => preset.models.includes(m));
  return free || preset.models[0];
}

/** Группы для выпадающего списка моделей: «Бесплатные» и «Остальные». */
export function modelGroups(preset?: ProviderPreset): Array<{ label: string; models: string[] }> {
  if (!preset || preset.models.length === 0) return [];
  const free = (preset.freeModels ?? []).filter(m => preset.models.includes(m));
  const rest = preset.models.filter(m => !free.includes(m));
  const groups: Array<{ label: string; models: string[] }> = [];
  if (free.length) groups.push({ label: 'Бесплатные', models: free });
  if (rest.length) groups.push({ label: 'Остальные', models: rest });
  return groups;
}
