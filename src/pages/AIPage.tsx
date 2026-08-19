import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Send, Key, Trash2, RefreshCw, Sparkles, User } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

const STORAGE_KEY = 'portal_ai_key';
const HISTORY_KEY = 'portal_ai_history';
const API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const MODEL = 'qwen2.5-72b-instruct';

const SYSTEM_PROMPT = `You are an AI assistant built into Portal Launcher, a Minecraft launcher. You help users with:
- Mod recommendations and compatibility
- Modpack creation and configuration
- Troubleshooting Java, crashes, and launch errors
- Explaining what different mods do
- Minecraft gameplay tips and optimization
- Instance setup (Fabric, Forge, Quilt, NeoForge)
Keep answers concise and practical. If asked about installing a mod, remind the user they can use the Discover tab.`;

export function AIPage() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [keyInput, setKeyInput] = useState('');
  const [showKeySetup, setShowKeySetup] = useState(() => !localStorage.getItem(STORAGE_KEY));
  const [messages, setMessages] = useState<Message[]>(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-100)));
  }, [messages]);

  const saveKey = () => {
    if (!keyInput.trim()) return;
    localStorage.setItem(STORAGE_KEY, keyInput.trim());
    setApiKey(keyInput.trim());
    setShowKeySetup(false);
    setKeyInput('');
  };

  const clearHistory = () => {
    setMessages([]);
    localStorage.removeItem(HISTORY_KEY);
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !apiKey) return;
    setInput('');
    setError('');

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text, ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const history = [...messages, userMsg].slice(-20);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history.map(m => ({ role: m.role, content: m.content })),
          ],
          max_tokens: 1024,
          stream: false,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '…';
      setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content, ts: Date.now() }]);
    } catch (e: any) {
      if ((e as any).name === 'AbortError') {
        setError('Запрос превысил 30 секунд. Проверьте API ключ и соединение.');
      } else {
        setError((e as any).message || 'Request failed');
      }
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, loading, apiKey, messages]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  if (showKeySetup) {
    return (
      <div className="flex-1 flex items-center justify-center p-8" style={{ background: 'var(--color-bg)' }}>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md p-8 rounded-2xl flex flex-col gap-6"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #06B6D4, #8B5CF6)' }}>
              <Bot className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>AI Assistant</h2>
            <p className="text-sm text-center" style={{ color: 'var(--color-text-secondary)' }}>
              Powered by Qwen 2.5 · Enter your DashScope API key to get started.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
              <Key className="w-4 h-4 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
              <input
                type="password"
                placeholder="sk-xxxxxxxxxxxxxxxx"
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveKey()}
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: 'var(--color-text)' }}
                autoFocus
              />
            </div>
            <button onClick={saveKey} disabled={!keyInput.trim()}
              className="py-3 rounded-xl font-semibold text-sm transition-opacity disabled:opacity-40"
              style={{ background: '#06B6D4', color: 'white' }}>
              Save API Key & Start
            </button>
            <p className="text-xs text-center" style={{ color: 'var(--color-text-tertiary)' }}>
              Get a free key at <span className="underline cursor-pointer" onClick={() => window.open('https://dashscope.aliyuncs.com', '_blank')}>dashscope.aliyuncs.com</span>
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full" style={{ background: 'var(--color-bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #06B6D4, #8B5CF6)' }}>
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>AI Assistant</h1>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Qwen 2.5 · 72B</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={clearHistory} title="Clear history"
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
            style={{ color: 'var(--color-text-tertiary)' }}>
            <Trash2 className="w-4 h-4" />
          </button>
          <button onClick={() => { setShowKeySetup(true); setKeyInput(apiKey); }} title="Change API key"
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
            style={{ color: 'var(--color-text-tertiary)' }}>
            <Key className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4 min-h-0">
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-12">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #06B6D420, #8B5CF620)', border: '1px solid var(--color-border)' }}>
              <Sparkles className="w-7 h-7" style={{ color: '#06B6D4' }} />
            </div>
            <div>
              <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Ask me anything about Minecraft</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Mods, modpacks, crashes, optimization…</p>
            </div>
            <div className="grid grid-cols-1 gap-2 w-full max-w-sm mt-2">
              {[
                'What are the best performance mods for 1.21?',
                'How do I fix Java out of memory errors?',
                'Recommend a good tech modpack for Forge',
              ].map(q => (
                <button key={q} onClick={() => { setInput(q); inputRef.current?.focus(); }}
                  className="px-4 py-2.5 rounded-xl text-left text-xs hover:bg-white/5 transition-colors"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        <AnimatePresence initial={false}>
          {messages.map(msg => (
            <motion.div key={msg.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center mt-0.5"
                style={msg.role === 'assistant'
                  ? { background: 'linear-gradient(135deg, #06B6D4, #8B5CF6)' }
                  : { background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                {msg.role === 'assistant'
                  ? <Bot className="w-3.5 h-3.5 text-white" />
                  : <User className="w-3.5 h-3.5" style={{ color: 'var(--color-text-secondary)' }} />}
              </div>
              <div className={`max-w-[78%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user' ? 'rounded-tr-sm' : 'rounded-tl-sm'
              }`} style={msg.role === 'user'
                ? { background: '#06B6D4', color: 'white' }
                : { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                {msg.content}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
            <div className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #06B6D4, #8B5CF6)' }}>
              <Bot className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              {[0,1,2].map(i => (
                <span key={i} className="w-1.5 h-1.5 rounded-full animate-bounce"
                  style={{ background: '#06B6D4', animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </motion.div>
        )}
        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm"
            style={{ background: 'rgba(231,76,60,0.1)', border: '1px solid var(--color-error)', color: 'var(--color-error)' }}>
            <RefreshCw className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
            <button onClick={send} className="ml-auto text-xs underline">Retry</button>
          </motion.div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 px-6 py-4" style={{ borderTop: '1px solid var(--color-border)' }}>
        <div className="flex items-end gap-3 px-4 py-3 rounded-2xl"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
            onKeyDown={handleKey}
            placeholder="Ask anything about Minecraft…"
            className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed"
            style={{ color: 'var(--color-text)', minHeight: '24px', maxHeight: '120px' }}
          />
          <button onClick={send} disabled={!input.trim() || loading}
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-all disabled:opacity-30"
            style={{ background: input.trim() && !loading ? '#06B6D4' : 'var(--color-surface-2)' }}>
            <Send className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
        <p className="text-center text-[10px] mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
          Qwen 2.5 · 72B · Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
