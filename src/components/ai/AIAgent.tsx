import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Send, X, ChevronUp, Sparkles, Loader2, Copy, Check, Trash2 } from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { invoke } from '@/lib/invoke-shim';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface AIAgentProps {
  onClose: () => void;
}

const SYSTEM_PROMPT = `You are Portal Assistant — an AI helper built into Portal Launcher, a Minecraft launcher.

Your role:
- Help users create, configure and troubleshoot Minecraft modpacks and instances
- Recommend mods, resource packs, shaders based on user preferences
- Explain Forge, Fabric, Quilt, NeoForge loader differences and compatibility
- Help with Java settings, RAM allocation, performance optimization
- Answer questions about Minecraft versions, snapshots, modding
- Help diagnose crash logs and error messages

Context available to you:
- The user may share their instance configuration (MC version, loader, installed mods)
- You can suggest specific mods from Modrinth/CurseForge by name
- Keep answers concise and actionable
- If you don't know something specific, say so rather than guessing
- Respond in the same language the user writes in
- Never use emojis in your responses
- Format responses with clear structure: headers, bullet points, code blocks when relevant

When the user asks about their instances, you have access to the instance store data that will be provided as context.`;

function getStoredApiKey(): string {
  try {
    return localStorage.getItem('portal-settings') 
      ? JSON.parse(localStorage.getItem('portal-settings')!).curseforgeApiKey ?? '' 
      : '';
  } catch { return ''; }
}

async function callAI(messages: ChatMessage[], contextInfo: string): Promise<string> {
  // Try to use an OpenAI-compatible API if configured
  const settingsRaw = localStorage.getItem('portal-settings');
  let aiEndpoint = '';
  let aiModel = 'gpt-4o-mini';
  let aiApiKey = '';
  
  try {
    if (settingsRaw) {
      const parsed = JSON.parse(settingsRaw);
      aiEndpoint = parsed?.aiEndpoint ?? '';
      aiModel = parsed?.aiModel ?? 'gpt-4o-mini';
      aiApiKey = parsed?.aiApiKey ?? '';
    }
  } catch {}

  const systemMessage: ChatMessage = {
    role: 'system',
    content: SYSTEM_PROMPT + (contextInfo ? `\n\nCurrent user context:\n${contextInfo}` : ''),
    timestamp: Date.now(),
  };

  if (aiEndpoint && aiApiKey) {
    try {
      const response = await fetch(aiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiApiKey}`,
        },
        body: JSON.stringify({
          model: aiModel,
          messages: [systemMessage, ...messages.map(m => ({ role: m.role, content: m.content }))],
          max_tokens: 2048,
          temperature: 0.7,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        return data.choices?.[0]?.message?.content ?? 'No response from AI.';
      }
    } catch {}
  }

  // Built-in offline responses for common questions
  const lastMsg = messages[messages.length - 1]?.content.toLowerCase() ?? '';
  
  if (lastMsg.includes('привет') || lastMsg.includes('hello') || lastMsg.includes('hi')) {
    return `Portal Assistant на связи. Я помогу вам с:\n\n- Созданием и настройкой сборок Minecraft\n- Подбором модов, ресурс-паков и шейдеров\n- Оптимизацией производительности\n- Диагностикой ошибок запуска\n\nЗадайте вопрос или опишите задачу.`;
  }
  
  if (lastMsg.includes('мод') && (lastMsg.includes('рекоменд') || lastMsg.includes('посовет') || lastMsg.includes('совет') || lastMsg.includes('что поставить'))) {
    return `Вот популярные моды по категориям:\n\n**Оптимизация:**\n- Sodium (Modrinth) — ускорение рендера\n- Lithium — оптимизация серверной логики\n- FerriteCore — уменьшение потребления RAM\n- Starlight — быстрый световой движок\n\n**Игровой контент:**\n- Create — механические конструкции\n- Tinkers Construct — крафт инструментов\n- Botania — магия растений\n\n**Утилиты:**\n- JEI/REI — просмотр рецептов\n- Waystones — быстрое перемещение\n- Roughly Enough Items — справочник рецептов\n\nКакой тип контента вас интересует? Уточните версию Minecraft и лоадер для более точных рекомендаций.`;
  }
  
  if (lastMsg.includes('шейдер') || lastMsg.includes('shader')) {
    return `Популярные шейдеры для modern Minecraft:\n\n**Лёгкие (хорошая производительность):**\n- BSL Shaders — классика, мягкий свет\n- Complementary Shaders — универсальный\n- Sildur's Vibrant — яркие цвета\n\n**Средние:**\n- Nostalgia Shader — ретро-атмосфера\n- Soft Voxels — мягкие объёмные пиксели\n\n**Тяжёлые (прекрасная картинка):**\n- SEUS Renewed — фотореалистичный\n- SEUS PTGI — трассировка лучей\n- Kappa Shader — детализация\n\nДля установки: Forge/NeoForge + Iris/OptiFine. Через Discover > Shaders в лаунчере.`;
  }
  
  if (lastMsg.includes('ошибк') || lastMsg.includes('баг') || lastMsg.includes('не работает') || lastMsg.includes('краш') || lastMsg.includes('crash')) {
    return `Для диагностики ошибки:\n\n1. **Проверьте логи:** Откройте сборку > вкладка "Логи" или файл .minecraft/logs/latest.log\n2. **Типичные проблемы:**\n   - OutOfMemoryError — увеличьте RAM в настройках сборки\n   - IncompatibleClassChangeError — конфликт модов, попробуйте отключить по одному\n   - Forge/NeoForge не ставится — проверьте версию Java (Forge 1.16+ нужна Java 8-17, NeoForge 1.20+ нужна Java 17+)\n3. **Безопасный режим:** В настройках сборки > Обслуживание > Безопасный режим\n\nСкопируйте ключевую часть лога ошибки и вставьте сюда — помогу разобраться.`;
  }
  
  if (lastMsg.includes('java') || lastMsg.includes('джава')) {
    return `Рекомендации по Java:\n\n| MC Version | Java |\n|---|---|\n| 1.8 - 1.16.5 | Java 8 (Azul Zulu / Temurin) |\n| 1.17 - 1.17.1 | Java 16 |\n| 1.18 - 1.20.4 | Java 17 |\n| 1.20.5 - 1.21.4 | Java 21 |\n| 1.22+ / Snapshot | Java 21-25 |\n\nPortal Launcher автоматически скачивает нужную Java через Settings > Minecraft > Java Manager.\n\n**Совет:** Не используйте bundled Java от Minecraft Launcher — она может конфликтовать.`;
  }
  
  if (lastMsg.includes('ram') || lastMsg.includes('память') || lastMsg.includes('оператив')) {
    return `Рекомендации по RAM:\n\n- **Ванильный Minecraft (1-50 модов):** 2-4 GB\n- **Средний модпак (50-150 модов):** 4-6 GB\n- **Тяжёлый модпак (150+ модов):** 6-8 GB\n- **Экстремальный (300+ модов):** 8-12 GB\n\nНе ставьте больше 10-12 GB — Java GC начнёт тормозить.\n\nНастройка: Библиотека > Выбор сборки > Настройки > Java и память.`;
  }
  
  if (lastMsg.includes('forge') || lastMsg.includes('fabric') || lastMsg.includes('quilt') || lastMsg.includes('neoforge') || lastMsg.includes('лоадер') || lastMsg.includes('загрузчик')) {
    return `Сравнение лоадеров:\n\n| Лоадер | Версии MC | Моды | Особенности |\n|---|---|---|---|\n| **Forge** | 1.7.10+ | ~50000+ | Самый поддерживаемый, старый и проверенный |\n| **Fabric** | 1.14+ | ~10000+ | Быстрое обновление, лёгкий, modern API |\n| **Quilt** | 1.14+ | ~1000+ | Форк Fabric, совместимость + свои фичи |\n| **NeoForge** | 1.20.1+ | ~5000+ | Форк Forge, исправленный API, активное развитие |\n\n**Совет для новичков:** Fabric для нового контента, Forge для больших модпаков.`;
  }
  
  // Default response
  return `Я понял ваш вопрос. Вот что могу подсказать:\n\n- Для создания сборки: Библиотека > Создать сборку\n- Для поиска модов: Обзор > поисковая строка\n- Для настройки Java: Настройки > Minecraft\n\nЕсли нужно конкретное руководство — опишите подробнее задачу: какая версия Minecraft, какие моды хотите, какие проблемы встречаете.\n\nДля расширенных ответов подключите API ключ ИИ в Настройки > Дополнительно > AI Agent.`;
}

export function AIAgent({ onClose }: AIAgentProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const instances = useInstanceStore(s => s.instances);
  const user = useAuthStore(s => s.user);

  const contextInfo = (() => {
    const parts: string[] = [];
    if (user) parts.push(`Logged in as: ${user.username} (${user.provider ?? 'microsoft'})`);
    parts.push(`Instances: ${instances.length}`);
    for (const inst of instances.slice(0, 5)) {
      parts.push(`- ${inst.name}: MC ${inst.minecraftVersion}, ${inst.modLoader}${inst.modLoaderVersion ? ' ' + inst.modLoaderVersion : ''}, RAM ${inst.maxRam}MB`);
    }
    return parts.join('\n');
  })();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!minimized) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [minimized]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const reply = await callAI([...messages, userMsg], contextInfo);
      const assistantMsg: ChatMessage = { role: 'assistant', content: reply, timestamp: Date.now() };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (e: any) {
      const errorMsg: ChatMessage = { role: 'assistant', content: `Ошибка: ${String(e)}`, timestamp: Date.now() };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, contextInfo]);

  const copyMessage = useCallback((idx: number, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    });
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
  }, []);

  return (
    <>
      {/* Minimized toggle button */}
      {minimized && (
        <motion.button
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          onClick={() => setMinimized(false)}
          className="fixed bottom-5 right-5 z-[900] flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold"
          style={{
            background: 'var(--color-primary)',
            color: 'var(--color-primary-text)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <Bot className="w-4 h-4" />
          Assistant
        </motion.button>
      )}

      {/* Full chat panel */}
      <AnimatePresence>
        {!minimized && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed bottom-5 right-5 z-[900] flex flex-col overflow-hidden"
            style={{
              width: 420,
              height: 560,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 shrink-0"
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="flex items-center justify-center w-7 h-7 rounded-md"
                  style={{ background: 'var(--color-primary-dim)' }}
                >
                  <Bot className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    Portal Assistant
                  </p>
                  <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                    AI-помощник по сборкам
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    onClick={clearChat}
                    className="p-1.5 rounded-md hover:bg-white/5"
                    title="Очистить чат"
                  >
                    <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} />
                  </button>
                )}
                <button
                  onClick={() => setMinimized(true)}
                  className="p-1.5 rounded-md hover:bg-white/5"
                  title="Свернуть"
                >
                  <ChevronUp className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
                </button>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-md hover:bg-white/5"
                  title="Закрыть"
                >
                  <X className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center py-8">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                    style={{ background: 'var(--color-primary-dim)' }}
                  >
                    <Sparkles className="w-6 h-6" style={{ color: 'var(--color-primary)' }} />
                  </div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    Portal Assistant
                  </p>
                  <p className="text-xs mt-1.5 max-w-[280px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                    Задайте вопрос о модах, сборках, настройках илидиагностике. Помогу подобрать контент и решить проблемы.
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-4 justify-center">
                    {['Посоветуй моды', 'Какой лоадер выбрать?', 'Проблемы с запуском', 'Настройка Java'].map(hint => (
                      <button
                        key={hint}
                        onClick={() => { setInput(hint); }}
                        className="px-2.5 py-1.5 text-[11px] font-medium rounded-md"
                        style={{
                          background: 'var(--color-surface-2)',
                          color: 'var(--color-text-secondary)',
                          border: '1px solid var(--color-border)',
                        }}
                      >
                        {hint}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, idx) => (
                <div
                  key={msg.timestamp + idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className="group relative max-w-[85%] px-3 py-2.5 rounded-lg text-[13px] leading-relaxed"
                    style={{
                      background: msg.role === 'user' ? 'var(--color-primary)' : 'var(--color-surface-2)',
                      color: msg.role === 'user' ? 'var(--color-primary-text)' : 'var(--color-text)',
                      border: msg.role === 'user' ? 'none' : '1px solid var(--color-border)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {msg.content}
                    {msg.role === 'assistant' && (
                      <button
                        onClick={() => copyMessage(idx, msg.content)}
                        className="absolute -top-2 -right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                      >
                        {copiedIdx === idx
                          ? <Check className="w-3 h-3" style={{ color: 'var(--color-success)' }} />
                          : <Copy className="w-3 h-3" style={{ color: 'var(--color-text-tertiary)' }} />
                        }
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-[13px]"
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--color-primary)' }} />
                    Думаю...
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="shrink-0 px-3 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Задайте вопрос..."
                  rows={1}
                  className="flex-1 resize-none px-3 py-2.5 text-[13px] rounded-lg outline-none"
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                    maxHeight: 80,
                    minHeight: 38,
                  }}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || loading}
                  className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0 disabled:opacity-40"
                  style={{
                    background: 'var(--color-primary)',
                    color: 'var(--color-primary-text)',
                  }}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[9px] mt-1.5 text-center" style={{ color: 'var(--color-text-tertiary)' }}>
                Подключите свой API ключ ИИ в Настройки для расширенных ответов
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
