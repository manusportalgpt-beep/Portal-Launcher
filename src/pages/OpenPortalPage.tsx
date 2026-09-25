import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, MessageSquare, Trash2, Sparkles, Send, StopCircle, ChevronDown, ChevronRight,
  Settings2, Bot, Hammer, DraftingCompass, Braces, ChevronLeft, Boxes, Check, Copy, Download,
  Gauge, Minimize2, CornerDownRight, Shield, ShieldCheck, ShieldAlert, Globe, ExternalLink,
  Package, Wand2, Image as ImageIcon, Search, X, FileDiff, Brain,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@/lib/invoke-shim';
import { useOpenCoreStore, activeProviders, isProviderEnabled, isModelEnabled, firstConnectedProvider } from '@/stores/opencoreStore';
import { useInstanceStore } from '@/stores/instanceStore';
import { useCurrentUser } from '@/stores/authStore';
import { toIconSrc } from '@/lib/icon-src';
import { resolveEndpoint, runAgentTurn, buildSystemPrompt, compressHistory, callProvider, estimateTokens } from '@/lib/opencore/agent';
import { contextWindow, BROWSER_LINKS } from '@/lib/opencore/providers';
import { Markdown, PortalImage } from '@/components/openportal/Markdown';
import { ModelManager } from '@/components/openportal/ModelManager';
import { PermissionModal } from '@/components/openportal/PermissionModal';
import type { ChatMessage, SessionData, SessionMeta, PermissionRequest, Attachment, ProjectContext, PermissionPreset, ModCard, FileChange } from '@/lib/opencore/types';

/** Р СѓСЃСЃРєР°СЏ С„РѕСЂРјР° РјРЅРѕР¶РµСЃС‚РІРµРЅРЅРѕРіРѕ С‡РёСЃР»Р°: plural(5, 'С‡Р°С‚', 'С‡Р°С‚Р°', 'С‡Р°С‚РѕРІ') в†’ 'С‡Р°С‚РѕРІ'. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** РЎС‚Р°СЂС‚РѕРІС‹Рµ С‚РµРјС‹ РїСѓСЃС‚РѕРіРѕ С‡Р°С‚Р°: РєР»РёРє РїРѕРґСЃС‚Р°РІР»СЏРµС‚ РіРѕС‚РѕРІСѓСЋ РєРѕРјР°РЅРґСѓ РІ РєРѕРјРїРѕР·РµСЂ. */
const START_TOPICS: { title: string; hint: string; prompt: string; icon: React.ReactNode; color: string }[] = [
  {
    title: 'РќР°Р№С‚Рё РјРѕРґ',
    hint: 'РћРїС‚РёРјРёР·Р°С†РёРё, Р±РёР±Р»РёРѕС‚РµРєРё, РјРµС…Р°РЅРёРєРё',
    prompt: 'РќР°Р№РґРё РјРѕРґ РЅР° СЃРєРѕСЂРѕСЃС‚СЊ Рё РїСЂРѕРёР·РІРѕРґРёС‚РµР»СЊРЅРѕСЃС‚СЊ РґР»СЏ ',
    icon: <Package size={15} />,
    color: 'var(--color-primary)',
  },
  {
    title: 'Р РµСЃСѓСЂСЃ-РїР°Рє',
    hint: 'РўРµРєСЃС‚СѓСЂС‹, С‚РµРјС‹, HD-РїР°РєРё',
    prompt: 'РќР°Р№РґРё СЂРµСЃСѓСЂСЃ-РїР°Рє СЃ С‚РµРєСЃС‚СѓСЂР°РјРё РІС‹СЃРѕРєРѕРіРѕ СЂР°Р·СЂРµС€РµРЅРёСЏ РґР»СЏ ',
    icon: <ImageIcon size={15} />,
    color: 'var(--color-primary)',
  },
  {
    title: 'РЁРµР№РґРµСЂС‹',
    hint: 'Complementary, SEUS, BSL',
    prompt: 'РќР°Р№РґРё С€РµР№РґРµСЂС‹ РґР»СЏ ',
    icon: <Wand2 size={15} />,
    color: 'var(--color-primary)',
  },
  {
    title: 'РЎРѕР·РґР°С‚СЊ С€РµР№РґРµСЂ',
    hint: 'GLSL, СЃРІРѕРё .vsh/.fsh Рё zip',
    prompt: 'РЎРѕР·РґР°Р№ С€РµР№РґРµСЂ РґР»СЏ Minecraft',
    icon: <Wand2 size={15} />,
    color: 'var(--color-primary)',
  },
  {
    title: 'РЎРѕР·РґР°С‚СЊ РјРѕРґ',
    hint: 'Java, СЃР±РѕСЂРєР° РІ .jar',
    prompt: 'РЎРѕР·РґР°Р№ РјРѕРґ РґР»СЏ РјРѕРµР№ СЃР±РѕСЂРєРё: ',
    icon: <Boxes size={15} />,
    color: 'var(--color-primary)',
  },
  {
    title: 'Р Р°Р·РѕР±СЂР°С‚СЊ СЃР±РѕСЂРєСѓ',
    hint: 'Р¤Р°Р№Р»С‹, Р»РѕРіРё, СѓСЃС‚Р°РЅРѕРІРєР° РјРѕРґРѕРІ',
    prompt: 'РџРѕСЃРјРѕС‚СЂРё РјРѕСЋ СЃР±РѕСЂРєСѓ Рё РѕР±СЉСЏСЃРЅРё, С‡С‚Рѕ РІ РЅРµР№ СѓСЃС‚Р°РЅРѕРІР»РµРЅРѕ Рё С‡С‚Рѕ РјРѕР¶РЅРѕ СѓР»СѓС‡С€РёС‚СЊ',
    icon: <Boxes size={15} />,
    color: 'var(--color-primary)',
  },
];

const HELP_TEXT = [
  '**РљРѕРјР°РЅРґС‹ OpenPortal:**',
  '- `/help` вЂ” СЃРїРёСЃРѕРє РєРѕРјР°РЅРґ Рё РёРЅСЃС‚СЂСѓРјРµРЅС‚РѕРІ',
  '- `/models` вЂ” РІС‹Р±СЂР°С‚СЊ РјРѕРґРµР»Рё Рё РєР»СЋС‡Рё',
  '- `/new` вЂ” РЅРѕРІС‹Р№ С‡Р°С‚',
  '- `/clear` вЂ” РѕС‡РёСЃС‚РёС‚СЊ С‡Р°С‚',
  '- `/compress` вЂ” СЃР¶Р°С‚СЊ РёСЃС‚РѕСЂРёСЋ (РєСЂР°С‚РєР°СЏ РІС‹Р¶РёРјРєР° РІРјРµСЃС‚Рѕ СЃС‚Р°СЂС‹С… СЃРѕРѕР±С‰РµРЅРёР№)',
  '- `/context` вЂ” РїРѕРєР°Р·Р°С‚СЊ СЂР°СЃС…РѕРґ РєРѕРЅС‚РµРєСЃС‚Р° Рё С‚РѕРєРµРЅРѕРІ',
  '- `/plan` вЂ” СЂРµР¶РёРј Plan (С‚РѕР»СЊРєРѕ РїР»Р°РЅ)',
  '- `/build` вЂ” СЂРµР¶РёРј Build (РІС‹РїРѕР»РЅСЏРµС‚ Р·Р°РґР°С‡Рё)',
  '- `/skill-creator <РѕРїРёСЃР°РЅРёРµ>` вЂ” Р°РіРµРЅС‚ СЃРѕР·РґР°СЃС‚ РЅРѕРІС‹Р№ РЅР°РІС‹Рє',
  '- `/skill-installer <РёРјСЏ/СЃСЃС‹Р»РєР°>` вЂ” Р°РіРµРЅС‚ РЅР°Р№РґС‘С‚ Рё СѓСЃС‚Р°РЅРѕРІРёС‚ РЅР°РІС‹Рє',
  '- `/cache` вЂ” СЂР°Р·РјРµСЂ РєРµС€Р° Р·Р°РІРёСЃРёРјРѕСЃС‚РµР№ РїРµСЃРѕС‡РЅРёС†С‹, `/cache clean` вЂ” РѕС‡РёСЃС‚РёС‚СЊ РµРіРѕ',
  '',
  '**РРЅСЃС‚СЂСѓРјРµРЅС‚С‹ Р°РіРµРЅС‚Р°** (Р°РіРµРЅС‚ РёСЃРїРѕР»СЊР·СѓРµС‚ РёС… СЃР°Рј, РїРѕ С…РѕРґСѓ Р·Р°РґР°С‡Рё): РІРµР±-РїРѕРёСЃРє Рё С‡С‚РµРЅРёРµ СЃС‚СЂР°РЅРёС†, ' +
  'HTTP-Р·Р°РїСЂРѕСЃС‹ Рє API, СЃРєР°С‡РёРІР°РЅРёРµ Р»СЋР±С‹С… С„Р°Р№Р»РѕРІ РІ РїРµСЃРѕС‡РЅРёС†Сѓ, С„Р°Р№Р»С‹ (С‡С‚РµРЅРёРµ/Р·Р°РїРёСЃСЊ/С‚РѕС‡РµС‡РЅР°СЏ РїСЂР°РІРєР°/РїРѕРёСЃРє РїРѕ РєРѕРґСѓ), ' +
  'РєРѕРјР°РЅРґС‹ (cmd/PowerShell), Р·Р°РїСѓСЃРє Python, СЃР±РѕСЂРєР° Рё СЂР°Р·Р±РѕСЂ .jar, Р°СЂС…РёРІС‹, СЂР°Р±РѕС‚Р° СЃ РёР·РѕР±СЂР°Р¶РµРЅРёСЏРјРё, ' +
  'РїР°СЂР°Р»Р»РµР»СЊРЅС‹Рµ СЃСѓР±Р°РіРµРЅС‚С‹, РіРµРЅРµСЂР°С†РёСЏ РєР°СЂС‚РёРЅРѕРє.',
  '',
  '**Р§С‚Рѕ Р°РіРµРЅС‚ СѓРјРµРµС‚ СЃРѕР·РґР°РІР°С‚СЊ РїСЂСЏРјРѕ РІ Р»Р°СѓРЅС‡РµСЂРµ:** РјРѕРґС‹ (Fabric/Forge/NeoForge/Quilt) СЃ РіРѕС‚РѕРІС‹Рј .jar, ' +
  'С€РµР№РґРµСЂС‹ РЅР° GLSL (OptiFine/Iris), СЂРµСЃСѓСЂСЃ-РїР°РєРё Рё С‚РµРєСЃС‚СѓСЂС‹, СЃРєСЂРёРїС‚С‹ РЅР° Python, РєРѕРЅС„РёРіРё Рё С‚РµРјС‹. ' +
  'Р•СЃР»Рё РїСЂРѕСЃРёС€СЊ В«СЃРѕР·РґР°Р№В» вЂ” РѕРЅ РїРёС€РµС‚ РєРѕРґ, Р° РЅРµ РёС‰РµС‚ РіРѕС‚РѕРІРѕРµ. Р•СЃР»Рё РїСЂРѕСЃРёС€СЊ В«РЅР°Р№РґРёВ» вЂ” РёС‰РµС‚ Рё СЃС‚Р°РІРёС‚.',
  '',
  'Р¤Р°Р№Р»С‹ РїСЂРёРєСЂРµРїР»СЏСЋС‚СЃСЏ РєРЅРѕРїРєРѕР№ В«+В» Сѓ РїРѕР»СЏ РІРІРѕРґР° Рё СЃРѕС…СЂР°РЅСЏСЋС‚СЃСЏ РєРЅРѕРїРєРѕР№ В«РЎРєР°С‡Р°С‚СЊВ» РІ В«Р—Р°РіСЂСѓР·РєРёВ».',
  '',
  '**Р¤РѕРЅРѕРІС‹Рµ Р·Р°РґР°С‡Рё:** РјРѕР¶РЅРѕ Р·Р°РїСѓСЃС‚РёС‚СЊ Р°РіРµРЅС‚Р° РІ РѕРґРЅРѕРј С‡Р°С‚Рµ Рё РїРµСЂРµРєР»СЋС‡РёС‚СЊСЃСЏ РІ РґСЂСѓРіРѕР№ вЂ” Р·Р°РґР°С‡Рё РІС‹РїРѕР»РЅСЏСЋС‚СЃСЏ РїР°СЂР°Р»Р»РµР»СЊРЅРѕ, СЃР»РµРІР° Сѓ Р°РєС‚РёРІРЅС‹С… С‡Р°С‚РѕРІ РєСЂСѓС‚РёС‚СЃСЏ РёРЅРґРёРєР°С‚РѕСЂ.',
].join('\n');

/** РџР°Р»РёС‚СЂР° РєРѕРјР°РЅРґ В«/В» РІ СЃС‚РёР»Рµ opencode. instant вЂ” РІС‹РїРѕР»РЅСЏРµС‚СЃСЏ СЃСЂР°Р·Сѓ, РёРЅР°С‡Рµ РІСЃС‚Р°РІР»СЏРµС‚СЃСЏ РІ РїРѕР»Рµ РґР»СЏ РїСЂРѕРґРѕР»Р¶РµРЅРёСЏ. */
const COMMANDS: { cmd: string; desc: string; instant: boolean }[] = [
  { cmd: '/help', desc: 'РЎРїРёСЃРѕРє РєРѕРјР°РЅРґ Рё РёРЅСЃС‚СЂСѓРјРµРЅС‚РѕРІ', instant: true },
  { cmd: '/models', desc: 'Р’С‹Р±СЂР°С‚СЊ РјРѕРґРµР»Рё Рё РєР»СЋС‡Рё', instant: true },
  { cmd: '/new', desc: 'РќРѕРІС‹Р№ С‡Р°С‚', instant: true },
  { cmd: '/clear', desc: 'РћС‡РёСЃС‚РёС‚СЊ СЃРѕРѕР±С‰РµРЅРёСЏ', instant: true },
  { cmd: '/compress', desc: 'РЎР¶Р°С‚СЊ РёСЃС‚РѕСЂРёСЋ РІ РєСЂР°С‚РєСѓСЋ РІС‹Р¶РёРјРєСѓ', instant: true },
  { cmd: '/continue', desc: 'РџСЂРѕРґРѕР»Р¶РёС‚СЊ РїСЂРµСЂРІР°РЅРЅСѓСЋ Р·Р°РґР°С‡Сѓ (РЅР°РїСЂРёРјРµСЂ, РїРѕСЃР»Рµ Р·Р°РєСЂС‹С‚РёСЏ Р»Р°СѓРЅС‡РµСЂР°)', instant: true },
  { cmd: '/context', desc: 'Р Р°СЃС…РѕРґ РєРѕРЅС‚РµРєСЃС‚Р° Рё С‚РѕРєРµРЅРѕРІ', instant: true },
  { cmd: '/plan', desc: 'Р РµР¶РёРј Plan вЂ” С‚РѕР»СЊРєРѕ РїР»Р°РЅ', instant: true },
  { cmd: '/build', desc: 'Р РµР¶РёРј Build вЂ” РІС‹РїРѕР»РЅСЏС‚СЊ Р·Р°РґР°С‡Рё', instant: true },
  { cmd: '/skill-creator', desc: 'РЎРѕР·РґР°С‚СЊ РЅРѕРІС‹Р№ РЅР°РІС‹Рє', instant: false },
  { cmd: '/skill-installer', desc: 'РќР°Р№С‚Рё Рё СѓСЃС‚Р°РЅРѕРІРёС‚СЊ РЅР°РІС‹Рє', instant: false },
  { cmd: '/cache', desc: 'РљРµС€ Р·Р°РІРёСЃРёРјРѕСЃС‚РµР№ РїРµСЃРѕС‡РЅРёС†С‹ (/cache clean вЂ” РѕС‡РёСЃС‚РёС‚СЊ)', instant: true },
];

/** Р Р°СЃС€РёСЂРµРЅРёРµ С„Р°Р№Р»Р° РёР· РёРјРµРЅРё (РІ РІРµСЂС…РЅРµРј СЂРµРіРёСЃС‚СЂРµ, РґР»СЏ Р±РµР№РґР¶Р°). */
function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toUpperCase() : 'FILE';
}

/** Р§РµР»РѕРІРµРєРѕС‡РёС‚Р°РµРјС‹Р№ СЂР°Р·РјРµСЂ. */
function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** base64 в†’ СЃС‚СЂРѕРєР° UTF-8 (РґР»СЏ РІСЃС‚СЂР°РёРІР°РЅРёСЏ СЃРѕРґРµСЂР¶РёРјРѕРіРѕ С‚РµРєСЃС‚РѕРІС‹С… РІР»РѕР¶РµРЅРёР№). */
function b64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** РљРѕРїРёСЂРѕРІР°РЅРёРµ РІ Р±СѓС„РµСЂ РѕР±РјРµРЅР° (clipboard API + С„РѕР»Р±СЌРє РґР»СЏ РІРµР±РІСЊСЋ). */
async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(ta);
  }
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2 overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-2)' }}>
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
        <Braces size={12} /> Р’РЅСѓС‚СЂРµРЅРЅРёРµ СЂР°СЃСЃСѓР¶РґРµРЅРёСЏ (Thinking)
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

function ToolMsg({ name, content, error, cards, changes, onInstalled }: { name: string; content: string; error?: boolean; cards?: ModCard[]; changes?: FileChange[]; onInstalled?: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  // РљР°СЂС‚РѕС‡РєРё СЂРµР·СѓР»СЊС‚Р°С‚Р° mod_search РїРѕРєР°Р·С‹РІР°СЋС‚СЃСЏ СЃСЂР°Р·Сѓ, Р±РµР· СЂР°СЃРєСЂС‹С‚РёСЏ: СЂР°РЅСЊС€Рµ
  // Р°РіРµРЅС‚ РѕС‚РґР°РІР°Р» С‚РѕР»СЊРєРѕ С‚РµРєСЃС‚, Рё РЅР°Р№РґРµРЅРЅС‹Р№ РєРѕРЅС‚РµРЅС‚ РїСЂРёС…РѕРґРёР»РѕСЃСЊ С‡РёС‚Р°С‚СЊ РІСЂСѓС‡РЅСѓСЋ.
  const imgMatch = name === 'generate_image' ? /\/op-image\/([A-Za-z0-9-]+\.(?:png|jpg|jpeg|webp|gif|avif|heic))/i.exec(content) : null;
  const showCards = !error && cards && cards.length > 0;
  return (
    <div className="ore-plain mb-2 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-2)' }}>
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] font-semibold"
        style={{ color: error ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
        <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        {name}
        {showCards && <span className="rounded px-1 text-[9px] font-bold" style={{ background: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}>{cards!.length}</span>}
        <span className="ml-auto font-normal" style={{ color: 'var(--color-text-tertiary)' }}>{error ? 'РѕС€РёР±РєР°' : 'РѕРє'}</span>
      </button>
      {changes && changes.length > 0 && <FileChanges changes={changes} />}
      {showCards && (
        <div className="grid gap-1.5 border-t p-1.5" style={{ borderColor: 'var(--color-border)' }}>
          {cards!.map(card => <ModResultCard key={card.projectId + card.versionNumber} card={card} onInstalled={onInstalled} />)}
        </div>
      )}
      {imgMatch && !error && (
        <div className="pt-1.5 px-2.5">
          <PortalImage name={imgMatch[1]} />
          <span className="mt-1 block text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>РЎРіРµРЅРµСЂРёСЂРѕРІР°РЅРЅРѕРµ РёР·РѕР±СЂР°Р¶РµРЅРёРµ вЂ” РјРѕР¶РЅРѕ РѕС‚РєСЂС‹С‚СЊ Рё СЃРєР°С‡Р°С‚СЊ РєРЅРѕРїРєРѕР№ СЂСЏРґРѕРј</span>
        </div>
      )}
      <AnimatePresence>
      {open && (
        <motion.pre initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          className="max-h-72 overflow-y-auto whitespace-pre-wrap px-2.5 pt-1.5 font-mono text-[11px] leading-4"
          style={{ color: 'var(--color-text-secondary)' }}>
          {content}
        </motion.pre>
      )}
      </AnimatePresence>
    </div>
  );
}

const MOD_TYPE_META: Record<string, { label: string; path: string }> = {
  mod: { label: 'РњРѕРґ', path: 'mod' },
  resourcepack: { label: 'Р РµСЃСѓСЂСЃ-РїР°Рє', path: 'resourcepack' },
  shaderpack: { label: 'РЁРµР№РґРµСЂ', path: 'shader' },
  modpack: { label: 'РњРѕРґРїР°Рє', path: 'modpack' },
};

const SOURCE_META: Record<string, { label: string; color: string }> = {
  modrinth: { label: 'Modrinth', color: 'var(--color-primary)' },
  curseforge: { label: 'CurseForge', color: 'var(--color-warning)' },
  other: { label: 'Р”СЂСѓРіРѕРµ', color: 'var(--color-text-tertiary)' },
};

/** РљР°СЂС‚РѕС‡РєР° РЅР°Р№РґРµРЅРЅРѕРіРѕ РєРѕРЅС‚РµРЅС‚Р°: РёРєРѕРЅРєР°, РЅР°Р·РІР°РЅРёРµ, РѕРїРёСЃР°РЅРёРµ, РїР»Р°С‚С„РѕСЂРјР°, С‚РёРї. */
function ModResultCard({ card, onInstalled }: { card: ModCard; onInstalled?: (text: string) => void }) {
  const type = MOD_TYPE_META[card.projectType] ?? MOD_TYPE_META.mod;
  const source = SOURCE_META[card.source] ?? SOURCE_META.other;
  const instances = useInstanceStore(s => s.instances);
  const project = useOpenCoreStore(s => s.config.project);
  const [detail, setDetail] = useState(false);
  const [pickBuild, setPickBuild] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const selectedId = project && project.kind === 'build' ? project.instanceId : '';
  const selectedName = instances.find(i => i.id === selectedId)?.name ?? '';

  const install = useCallback(async (instanceId: string) => {
    const inst = instances.find(i => i.id === instanceId);
    if (!inst || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await invoke<any[]>('install_mod', {
        instanceId,
        downloadUrl: card.downloadUrl,
        fileName: card.fileName,
        modId: card.projectId,
        modName: card.title,
        modVersion: card.versionNumber,
        versionId: '',
        source: card.source,
        modType: card.projectType,
        projectId: card.projectId,
        author: card.author,
        iconUrl: card.iconUrl,
      });
      const count = Array.isArray(res) ? res.length : 0;
      setDone(true);
      setPickBuild(false);
      // РђРіРµРЅС‚ СЃСЂР°Р·Сѓ СѓР·РЅР°С‘С‚ РѕР± СѓСЃС‚Р°РЅРѕРІРєРµ вЂ” СЃРѕРѕР±С‰РµРЅРёРµ СѓС…РѕРґРёС‚ РІ С‚РѕС‚ Р¶Рµ С‡Р°С‚.
      onInstalled?.(`РЈСЃС‚Р°РЅРѕРІР»РµРЅРѕ РІ СЃР±РѕСЂРєСѓ В«${inst.name}В»: ${card.title} (${type.label})${count ? `, С„Р°Р№Р»РѕРІ: ${count}` : ''}. РџРµСЂРµСЃРѕР±РµСЂРё СЃР±РѕСЂРєСѓ, С‡С‚РѕР±С‹ РєРѕРЅС‚РµРЅС‚ РїСЂРѕРёРЅРґРµРєСЃРёСЂРѕРІР°Р»СЃСЏ.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [card, instances, busy, onInstalled, type.label]);

  return (
    <div className="overflow-hidden rounded-md" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <button onClick={() => setDetail(d => !d)} title={detail ? 'РЎРІРµСЂРЅСѓС‚СЊ' : 'РћС‚РєСЂС‹С‚СЊ РІ Р»Р°СѓРЅС‡РµСЂРµ'}
        className="flex w-full items-start gap-2.5 p-2 text-left transition-colors hover:bg-[var(--color-surface-2)]">
        {card.iconUrl
          ? <img src={card.iconUrl} alt="" className="h-10 w-10 shrink-0 rounded" style={{ objectFit: 'cover', imageRendering: 'auto' }} />
          : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded text-[9px] font-black" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)' }}>{type.label.slice(0, 2).toUpperCase()}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[12px] font-bold" style={{ color: 'var(--color-text)' }}>{card.title}</span>
            {card.versionNumber && <span className="shrink-0 font-mono text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{card.versionNumber}</span>}
          </div>
          {card.description && <p className="mt-0.5 line-clamp-2 text-[11px] leading-4" style={{ color: 'var(--color-text-secondary)' }}>{card.description}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)' }}>{source.label}</span>
            <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>{type.label}</span>
            <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>{card.platform}</span>
            {card.loaders.slice(0, 3).map(l => <span key={l} className="rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)' }}>{l}</span>)}
            {card.gameVersions.slice(0, 2).map(v => <span key={v} className="rounded px-1.5 py-0.5 font-mono text-[9px]" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)' }}>{v}</span>)}
          </div>
        </div>
      </button>

      <div className="flex items-center gap-1.5 border-t px-2 py-1.5" style={{ borderColor: 'var(--color-border)' }}>
        {card.installable ? (
          done ? (
            <span className="text-[10px] font-bold" style={{ color: 'var(--color-success)' }}>РЈСЃС‚Р°РЅРѕРІР»РµРЅРѕ</span>
          ) : selectedId ? (
            <button onClick={() => void install(selectedId)} disabled={busy}
              className="rounded px-2 py-1 text-[10px] font-bold disabled:opacity-50"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
              {busy ? 'РЈСЃС‚Р°РЅРѕРІРєР°вЂ¦' : `РЈСЃС‚Р°РЅРѕРІРёС‚СЊ РІ В«${selectedName || 'СЃР±РѕСЂРєСѓ'}В»`}
            </button>
          ) : (
            <button onClick={() => setPickBuild(true)}
              className="rounded px-2 py-1 text-[10px] font-bold"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
              РЈСЃС‚Р°РЅРѕРІРёС‚СЊ вЂ” РІС‹Р±СЂР°С‚СЊ СЃР±РѕСЂРєСѓ
            </button>
          )
        ) : (
          <span className="text-[10px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>РќРµС‚ С„Р°Р№Р»Р° РїРѕРґ РІС‹Р±СЂР°РЅРЅСѓСЋ РІРµСЂСЃРёСЋ</span>
        )}
        <span className="flex-1" />
        <span className="text-[9px]" style={{ color: card.installable ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
          {card.installable ? 'СѓСЃС‚Р°РЅРѕРІРєР° РґРѕСЃС‚СѓРїРЅР°' : 'РЅРµ РЅР°Р№РґРµРЅ С„Р°Р№Р»'}
        </span>
      </div>

      {error && <p className="px-2 pb-1.5 text-[10px]" style={{ color: 'var(--color-error)' }}>{error}</p>}

      {pickBuild && (
        <div className="border-t p-1.5" style={{ borderColor: 'var(--color-border)' }}>
          <p className="px-1 pb-1 text-[10px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>РљСѓРґР° СѓСЃС‚Р°РЅРѕРІРёС‚СЊ?</p>
          <div className="max-h-40 overflow-y-auto">
            {instances.length === 0 && <p className="px-1 py-1 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>РЎР±РѕСЂРѕРє РїРѕРєР° РЅРµС‚.</p>}
            {instances.map(inst => (
              <button key={inst.id} onClick={() => void install(inst.id)} disabled={busy}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-[var(--color-surface-2)]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: inst.color || 'var(--color-surface-2)' }} />
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold" style={{ color: 'var(--color-text)' }}>{inst.name}</span>
                <span className="shrink-0 font-mono text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>{inst.minecraftVersion}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {detail && (
        <div className="border-t p-2.5" style={{ borderColor: 'var(--color-border)' }}>
          <div className="mb-2 flex items-center gap-2">
            <button onClick={() => setDetail(false)}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-bold"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
              <ChevronLeft size={11} /> РќР°Р·Р°Рґ
            </button>
            <span className="flex-1" />
            <button onClick={() => { void invoke('open_url', { url: card.url }); }}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-bold"
              style={{ color: 'var(--color-text-tertiary)' }}>
              РћС‚РєСЂС‹С‚СЊ РЅР° Modrinth <ExternalLink size={10} />
            </button>
          </div>
          {card.iconUrl && (
            <img src={card.iconUrl} alt="" className="mb-2 w-full rounded" style={{ maxHeight: 180, objectFit: 'contain', imageRendering: 'auto' }} />
          )}
          <p className="whitespace-pre-wrap text-[12px] leading-5" style={{ color: 'var(--color-text-secondary)' }}>{card.description || 'РћРїРёСЃР°РЅРёРµ РЅРµ СѓРєР°Р·Р°РЅРѕ.'}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {card.author && <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>Р°РІС‚РѕСЂ: {card.author}</span>}
            <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>Р·Р°РіСЂСѓР·РѕРє: {fmtNum(card.downloads)}</span>
            {card.fileName && <span className="rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)' }}>{card.fileName}</span>}
          </div>
          {card.gameVersions.length > 0 && (
            <p className="mt-1.5 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
              Р’РµСЂСЃРёРё: {card.gameVersions.slice(0, 12).join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Р§РµР»РѕРІРµРєРѕС‡РёС‚Р°РµРјРѕРµ С‡РёСЃР»Рѕ С‚РѕРєРµРЅРѕРІ. */
function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/** РРЅРґРёРєР°С‚РѕСЂ СЂР°СЃС…РѕРґР° РєРѕРЅС‚РµРєСЃС‚РЅРѕРіРѕ РѕРєРЅР°: РїСЂРѕС†РµРЅС‚, РґРµС‚Р°Р»Рё Рё РєРЅРѕРїРєР° СЃР¶Р°С‚РёСЏ РёСЃС‚РѕСЂРёРё. */
function ContextMeter({ onCompact }: { onCompact: () => void }) {
  const usage = useOpenCoreStore(s => s.usage);
  const messages = useOpenCoreStore(s => s.messages);
  const cfg = useOpenCoreStore(s => s.config);
  const [open, setOpen] = useState(false);
  // Лимит берём из активной модели напрямую, а не только из usage.limit:
  // раньше значение обновлялось лишь после отправки сообщения, поэтому
  // сразу после смены модели метр показывал устаревшие 128K.
  const activeModel = useMemo(() => {
    const provider = activeProviders(cfg).find(p => p.id === cfg.activeProviderId) ?? firstConnectedProvider(cfg);
    if (!provider) return null;
    const model = provider.models.find(m => m.id === cfg.activeModelId);
    return model ? { model, providerId: provider.id } : null;
  }, [cfg]);
  const override = activeModel ? (cfg.modelContexts ?? {})[`${activeModel.providerId}/${activeModel.model.id}`] : undefined;
  const modelLimit = activeModel
    ? contextWindow({ ...activeModel.model, contextLength: override ?? activeModel.model.contextLength }, activeModel.providerId)
    : 0;
  const limit = modelLimit || usage.limit || 128_000;
  // Р’С‹Р¶РёРјРєРё СЃР¶Р°С‚РѕР№ РёСЃС‚РѕСЂРёРё РјРѕРґРµР»СЊ РїРѕР»СѓС‡Р°РµС‚, РЅРѕ РІ СЂР°СЃС…РѕРґ РєРѕРЅС‚РµРєСЃС‚Р° РѕРЅРё РЅРµ РёРґСѓС‚,
  // РїРѕСЌС‚РѕРјСѓ РІС‹С‡РёС‚Р°РµРј РёС… РѕС†РµРЅРєСѓ РёР· Р·Р°РЅСЏС‚РѕРіРѕ РјРµСЃС‚Р°.
  const summaryTokens = useMemo(
    () => messages.filter(m => m.summary === true).reduce((sum, m) => sum + estimateTokens(m.content), 0),
    [messages],
  );
  const context = Math.max(0, usage.context - summaryTokens);
  const pct = Math.min(100, Math.round((context / limit) * 100));
  const total = usage.input + usage.output;
  const color = pct >= 85 ? 'var(--color-error)' : pct >= 60 ? 'var(--color-warning)' : 'var(--color-primary)';
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} title="Р Р°СЃС…РѕРґ РєРѕРЅС‚РµРєСЃС‚Р°"
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-bold"
        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
        <Gauge size={11} style={{ color }} />
        <span style={{ color }}>{usage.estimated ? '~' : ''}{pct}%</span>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-40 mb-2 w-64 rounded-lg border p-3 text-[11px]"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>
          <p className="mb-1.5 text-xs font-black" style={{ color: 'var(--color-text)' }}>РљРѕРЅС‚РµРєСЃС‚</p>
          <div className="mb-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--color-surface-2)' }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
          </div>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            РџРѕСЃР»РµРґРЅРёР№ Р·Р°РїСЂРѕСЃ: <b style={{ color: 'var(--color-text)' }}>{fmtNum(context)}</b> / {fmtNum(limit)} С‚РѕРєРµРЅРѕРІ ({pct}%){usage.estimated ? ' вЂ” РѕС†РµРЅРєР°' : ''}
          </p>
          {summaryTokens > 0 && (
            <p className="mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              Р’С‹Р¶РёРјРєРё СЃР¶Р°С‚РѕР№ РёСЃС‚РѕСЂРёРё: {fmtNum(summaryTokens)} С‚РѕРєРµРЅРѕРІ вЂ” РјРѕРґРµР»СЊ РёС… РІРёРґРёС‚, РЅРѕ РІ СЂР°СЃС…РѕРґ РЅРµ РІС…РѕРґСЏС‚.
            </p>
          )}
          <p className="mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            Р—Р° СЃРµСЃСЃРёСЋ: {fmtNum(usage.input)} РІС…РѕРґ В· {fmtNum(usage.output)} РІС‹С…РѕРґ В· <b style={{ color: 'var(--color-text)' }}>{fmtNum(total)}</b> РІСЃРµРіРѕ
          </p>
          <button onClick={() => { setOpen(false); onCompact(); }}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 font-bold"
            style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
            <Minimize2 size={11} /> РЎР¶Р°С‚СЊ РёСЃС‚РѕСЂРёСЋ
          </button>
        </div>
      )}
    </div>
  );
}

/** Р‘Р»РѕРє РІС‹Р¶РёРјРєРё СЃР¶Р°С‚РѕР№ РёСЃС‚РѕСЂРёРё: РІРёРґРµРЅ РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ Рё РјРѕРґРµР»Рё, РЅРѕ РЅРµ РІС…РѕРґРёС‚ РІ СЂР°СЃС…РѕРґ РєРѕРЅС‚РµРєСЃС‚Р°. */
function SummaryBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-2 overflow-hidden rounded-lg" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
        <ChevronRight size={12} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} style={{ color: 'var(--color-text-tertiary)' }} />
        <span className="text-[11px] font-bold" style={{ color: 'var(--color-text)' }}>Р’С‹Р¶РёРјРєР° РєРѕРЅС‚РµРєСЃС‚Р°</span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>РІРёРґРµРЅ РјРѕРґРµР»Рё, РЅРµ РІС…РѕРґРёС‚ РІ СЂР°СЃС…РѕРґ</span>
      </button>
      {open && (
        <div className="border-t px-3 py-2 text-[12px] leading-5" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
          <Markdown text={content} />
        </div>
      )}
    </div>
  );
}

/** РЎРїРёСЃРѕРє РёР·РјРµРЅС‘РЅРЅС‹С… С„Р°Р№Р»РѕРІ: В«РёРјСЏ-С„Р°Р№Р»Р° +12 в€’3В», СЂР°Р·РІРѕСЂР°С‡РёРІР°РµС‚СЃСЏ РІ diff. */
function FileChanges({ changes }: { changes: FileChange[] }) {
  const [openPath, setOpenPath] = useState<string | null>(null);
  return (
    <div className="mb-2 overflow-hidden rounded-lg" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <FileDiff size={12} style={{ color: 'var(--color-text-secondary)' }} />
        <span className="text-[11px] font-bold" style={{ color: 'var(--color-text)' }}>РР·РјРµРЅС‘РЅРЅС‹Рµ С„Р°Р№Р»С‹</span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{changes.length}</span>
      </div>
      <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
        {changes.map(change => {
          const key = `${change.root}/${change.path}`;
          const isOpen = openPath === key;
          return (
            <div key={key} className="border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
              <button onClick={() => setOpenPath(isOpen ? null : key)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--color-surface)]">
                <ChevronRight size={11} className={`shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} style={{ color: 'var(--color-text-tertiary)' }} />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]" style={{ color: 'var(--color-text)' }} title={key}>{change.path}</span>
                {change.created && <span className="shrink-0 rounded px-1 text-[9px] font-bold" style={{ background: 'var(--color-surface)', color: 'var(--color-success)' }}>РЅРѕРІС‹Р№</span>}
                <span className="shrink-0 font-mono text-[10px] font-bold" style={{ color: 'var(--color-success)' }}>+{change.added}</span>
                <span className="shrink-0 font-mono text-[10px] font-bold" style={{ color: 'var(--color-error)' }}>в€’{change.removed}</span>
              </button>
              {isOpen && (
                <div className="max-h-72 overflow-auto border-t px-2 py-1.5" style={{ borderColor: 'var(--color-border)' }}>
                  {change.lines.length === 0 && <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>РќРµС‚ СЃС‚СЂРѕРє РґР»СЏ РїРѕРєР°Р·Р°.</p>}
                  {change.lines.map((line, i) => (
                    <div key={i} className="flex items-start gap-2 font-mono text-[10px] leading-4"
                      style={{
                        background: line.kind === 'add' ? 'rgba(38,166,65,0.12)'
                          : line.kind === 'remove' ? 'rgba(218,54,51,0.12)' : 'transparent',
                        color: line.kind === 'context' ? 'var(--color-text-tertiary)' : 'var(--color-text)',
                      }}>
                      <span className="w-8 shrink-0 select-none text-right" style={{ color: 'var(--color-text-tertiary)' }}>{line.after ?? ''}</span>
                      <span className="w-2 shrink-0 select-none" style={{ color: line.kind === 'add' ? 'var(--color-success)' : line.kind === 'remove' ? 'var(--color-error)' : 'transparent' }}>
                        {line.kind === 'add' ? '+' : line.kind === 'remove' ? 'в€’' : ' '}
                      </span>
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{line.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: 'build' | 'plan'; onChange: (m: 'build' | 'plan') => void }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg p-0.5" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
      <button onClick={() => onChange('build')} title="Build вЂ” РІС‹РїРѕР»РЅСЏРµС‚ Р·Р°РґР°С‡Рё"
        className={`flex items-center gap-1 rounded-[7px] px-2 py-1 text-[10px] font-bold transition-colors ${mode === 'build' ? '' : 'opacity-50 hover:opacity-80'}`}
        style={mode === 'build'
          ? { background: 'var(--color-primary)', color: 'var(--color-primary-text)' }
          : { color: 'var(--color-text-secondary)' }}>
        <Hammer size={11} /> Build
      </button>
      <button onClick={() => onChange('plan')} title="Plan вЂ” С‚РѕР»СЊРєРѕ РїР»Р°РЅ, Р±РµР· РёР·РјРµРЅРµРЅРёР№"
        className={`flex items-center gap-1 rounded-[7px] px-2 py-1 text-[10px] font-bold transition-colors ${mode === 'plan' ? '' : 'opacity-50 hover:opacity-80'}`}
        style={mode === 'plan'
          ? { background: 'var(--color-primary)', color: 'var(--color-primary-text)' }
          : { color: 'var(--color-text-secondary)' }}>
        <DraftingCompass size={11} /> Plan
      </button>
    </div>
  );
}

function EffortPicker({ value, onChange }: { value: 'minimal' | 'low' | 'medium' | 'high'; onChange: (v: 'minimal' | 'low' | 'medium' | 'high') => void }) {
  const [open, setOpen] = useState(false);
  const levels: { id: 'minimal' | 'low' | 'medium' | 'high'; label: string; title: string }[] = [
    { id: 'minimal', label: 'РњРёРЅ', title: 'РњРёРЅРёРјСѓРј СЂР°СЃСЃСѓР¶РґРµРЅРёР№ вЂ” Р±С‹СЃС‚СЂРµРµ Рё РґРµС€РµРІР»Рµ' },
    { id: 'low', label: 'РќРёР·', title: 'РќРµРјРЅРѕРіРѕ СЂР°СЃСЃСѓР¶РґРµРЅРёР№' },
    { id: 'medium', label: 'РЎСЂРµРґ', title: 'РћР±С‹С‡РЅС‹Р№ СѓСЂРѕРІРµРЅСЊ СЂР°СЃСЃСѓР¶РґРµРЅРёР№' },
    { id: 'high', label: 'Р’С‹СЃ', title: 'РњР°РєСЃРёРјСѓРј СЂР°СЃСЃСѓР¶РґРµРЅРёР№ вЂ” РјРµРґР»РµРЅРЅРµРµ, РЅРѕ РІРЅРёРјР°С‚РµР»СЊРЅРµРµ' },
  ];
  const current = levels.find(l => l.id === value) ?? levels[2];
  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen(o => !o)} title={current.title}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold transition-colors hover:bg-[var(--color-surface)]"
        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
        <Brain size={11} style={{ color: 'var(--color-primary)' }} />
        {current.label}
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-tertiary)' }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-50 mb-2 w-40 overflow-hidden rounded-lg border p-1"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>
            {levels.map(l => (
              <button key={l.id} title={l.title} onClick={() => { onChange(l.id); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] font-semibold transition-colors hover:bg-[var(--color-surface-2)]"
                style={{ color: l.id === value ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: l.id === value ? 'var(--color-primary)' : 'var(--color-border-strong)' }} />
                {l.label}
              </button>
            ))}
            <p className="px-2 py-1 text-[9px] leading-3" style={{ color: 'var(--color-text-tertiary)' }}>
              Р Р°Р±РѕС‚Р°РµС‚ Сѓ РјРѕРґРµР»РµР№ СЃ СЂР°СЃСЃСѓР¶РґРµРЅРёРµРј. Р”Р»СЏ РѕСЃС‚Р°Р»СЊРЅС‹С… РїР°СЂР°РјРµС‚СЂ РЅРµ РѕС‚РїСЂР°РІР»СЏРµС‚СЃСЏ.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function PresetToggle({ preset, onChange }: { preset: PermissionPreset; onChange: (p: PermissionPreset) => void }) {
  const presets: { id: PermissionPreset; label: string; icon: React.ReactNode; title: string }[] = [
    { id: 'dfa', label: 'DFA', icon: <ShieldAlert size={10} />, title: 'DFA вЂ” СЃРїСЂР°С€РёРІР°РµС‚ СЂР°Р·СЂРµС€РµРЅРёСЏ (РєР°Рє СЂР°РЅСЊС€Рµ)' },
    { id: 'fa', label: 'FA', icon: <ShieldCheck size={10} />, title: 'FA вЂ” РґРµР»Р°РµС‚ Р±РµР· РІРѕРїСЂРѕСЃРѕРІ, РєСЂРѕРјРµ СѓСЃС‚Р°РЅРѕРІС‰РёРєРѕРІ (.exe/.msi)' },
    { id: 'ask', label: 'ASK', icon: <Shield size={10} />, title: 'ASK вЂ” С‚РѕР»СЊРєРѕ РёС‰РµС‚ Рё С‡РёС‚Р°РµС‚, РЅРёС‡РµРіРѕ РЅРµ СЃРѕР·РґР°С‘С‚' },
  ];
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg p-0.5" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }} title={presets.find(p => p.id === preset)?.title}>
      {presets.map(p => (
        <button key={p.id} title={p.title} onClick={() => onChange(p.id)}
          className={`flex items-center gap-1 rounded-[7px] px-1.5 py-1 text-[10px] font-bold transition-colors ${preset === p.id ? '' : 'opacity-50 hover:opacity-80'}`}
          style={preset === p.id ? { background: 'var(--color-primary)', color: 'var(--color-primary-text)' } : { color: 'var(--color-text-secondary)' }}>
          {p.icon} {p.label}
        </button>
      ))}
    </div>
  );
}

function ChatBubble({ m, onContinue, streaming, onInstalled }: { m: ChatMessage; onContinue?: () => void; streaming?: boolean; onInstalled?: (text: string) => void }) {
  const cfg = useOpenCoreStore(s => s.config);
  const [copied, setCopied] = useState(false);
  const providers = activeProviders(cfg).filter(p => isProviderEnabled(p, cfg));
  const activeProv = providers.find(p => p.id === cfg.activeProviderId) ?? firstConnectedProvider(cfg);
  const meta = [m.model, activeProv?.name].filter(Boolean).join(' В· ');
  const copy = async () => {
    await copyToClipboard(m.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const actions = (
    <div className="absolute -top-2.5 right-2 z-10 flex items-center gap-0.5 rounded-full px-1 py-0.5 opacity-0 transition-opacity group-hover:opacity-100"
      style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', boxShadow: '0 4px 16px rgba(0,0,0,.25)' }}>
      {onContinue && (
        <button onClick={onContinue} title="РџСЂРѕРґРѕР»Р¶РёС‚СЊ РѕС‚РІРµС‚ СЃ РјРµСЃС‚Р° РѕР±СЂС‹РІР°"
          className="flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-surface)]"
          style={{ color: 'var(--color-text-secondary)' }}>
          <CornerDownRight size={11} />
        </button>
      )}
      <button onClick={() => void copy()} title="РЎРєРѕРїРёСЂРѕРІР°С‚СЊ С‚РµРєСЃС‚"
        className="flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-surface)]"
        style={{ color: copied ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
      {m.role === 'assistant' && meta && (
        <span className="hidden max-w-[220px] truncate px-1 text-[9px] font-semibold min-[480px]:inline"
          style={{ color: 'var(--color-text-tertiary)' }}>{meta}</span>
      )}
    </div>
  );
  if (m.summary) {
    // Р’С‹Р¶РёРјРєР° СЃР¶Р°С‚РѕР№ РёСЃС‚РѕСЂРёРё: РµС‘ РІРёРґРёС‚ Рё РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ, Рё РјРѕРґРµР»СЊ, РЅРѕ РѕРЅР° РЅРµ
    // СѓС‡РёС‚С‹РІР°РµС‚СЃСЏ РІ СЂР°СЃС…РѕРґРµ РєРѕРЅС‚РµРєСЃС‚Р° вЂ” РїРѕСЌС‚РѕРјСѓ РїРѕРєР°Р·С‹РІР°РµС‚СЃСЏ РѕС‚РґРµР»СЊРЅС‹Рј
    // Р±Р»РѕРєРѕРј, Р° РЅРµ РѕР±С‹С‡РЅРѕР№ СЂРµРїР»РёРєРѕР№ Р°РіРµРЅС‚Р°.
    return <SummaryBlock content={m.content} />;
  }
  if (m.role === 'tool') {
    return <ToolMsg name={m.toolName ?? m.content.slice(0, 40)} content={m.content} error={m.error} cards={m.cards} changes={m.changes} onInstalled={onInstalled} />;
  }
  if (m.role === 'user') {
    return (
      <div className="group relative flex justify-end">
        {actions}
        <div className="max-w-[80%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-[13px] leading-6" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', cursor: 'text', userSelect: 'text' }}>
          <Markdown text={m.content} />
          {m.attachments && m.attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {m.attachments.map((a, i) => <AttachmentChip key={i} a={a} />)}
            </div>
          )}
        </div>
      </div>
    );
  }
  // assistant
  return (
    <div className="group relative flex justify-start">
      {actions}
      <div className="max-w-[92%] min-w-0 flex-1">
        {m.thinking && <ThinkingBlock text={m.thinking} />}
        {m.content ? (
          <div className="rounded-2xl rounded-bl-md px-3.5 py-2.5" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', cursor: 'text', userSelect: 'text' }}>
            <Markdown text={m.content} streaming={streaming} />
          </div>
        ) : (
          null
        )}
        {m.error && <p className="mt-1 text-[11px]" style={{ color: 'var(--color-error)' }}>Р­С‚Рѕ СЃРѕРѕР±С‰РµРЅРёРµ РјРѕРіР»Рѕ Р±С‹С‚СЊ СЃРіРµРЅРµСЂРёСЂРѕРІР°РЅРѕ РѕС€РёР±РѕС‡РЅРѕ. РџСЂРѕРІРµСЂСЊ РєРѕРЅС‚РµРєСЃС‚ Рё РїРѕРїСЂРѕР±СѓР№ РµС‰С‘ СЂР°Р·.</p>}
      </div>
    </div>
  );
}

/** РљР°СЂС‚РѕС‡РєР° РїСЂРёРєСЂРµРїР»С‘РЅРЅРѕРіРѕ С„Р°Р№Р»Р°: Р±РµР№РґР¶ СЂР°СЃС€РёСЂРµРЅРёСЏ, СЂР°Р·РјРµСЂ, РёРјСЏ Рё В«РЎРєР°С‡Р°С‚СЊВ» РІ В«Р—Р°РіСЂСѓР·РєРёВ». */
function AttachmentChip({ a, onRemove }: { a: Attachment; onRemove?: () => void }) {
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle');
  const [open, setOpen] = useState(false);
  const isImg = a.type.startsWith('image/') && !!a.dataUrl;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const save = async () => {
    if (state === 'saving') return;
    const b64 = a.base64 ?? (a.dataUrl ? a.dataUrl.split(',')[1] : '');
    if (!b64) return;
    setState('saving');
    try {
      await invoke('op_save_to_downloads', { fileName: a.name, b64 });
      setState('done');
      setTimeout(() => setState('idle'), 1800);
    } catch (e) {
      console.error('[OpenPortal] download failed', e);
      setState('idle');
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[11px]" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
      {isImg
        ? <img src={a.dataUrl} alt="" className="h-8 w-8 shrink-0 cursor-zoom-in rounded-lg object-cover"
            onClick={() => setOpen(true)} />
        : <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[7px] font-black"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}>{extOf(a.name)}</div>}
      <div className="min-w-0">
        <p className="max-w-[150px] truncate font-semibold leading-4" style={{ color: 'var(--color-text)' }}>{a.name}</p>
        <p className="text-[9px] leading-3" style={{ color: 'var(--color-text-tertiary)' }}>{extOf(a.name)} В· {a.size ? fmtSize(a.size) : 'вЂ”'}</p>
      </div>
      <button onClick={() => void save()} title="РЎРєР°С‡Р°С‚СЊ РІ В«Р—Р°РіСЂСѓР·РєРёВ»"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-surface)]"
        style={{ color: state === 'done' ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>
        {state === 'saving'
          ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          : state === 'done' ? <Check size={12} /> : <Download size={12} />}
      </button>
      {onRemove && (
        <button onClick={onRemove} title="РЈР±СЂР°С‚СЊ" className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-error)]">вњ•</button>
      )}
      {open && isImg && (
        <span
          className="fixed inset-0 z-[70] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={() => setOpen(false)}>
          <span onClick={e => e.stopPropagation()}>
            <img src={a.dataUrl} alt={a.name} className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain"
              style={{ boxShadow: '0 24px 80px rgba(0,0,0,.6)' }} />
          </span>
        </span>
      )}
    </div>
  );
}

function CurrentModelPicker() {
  const cfg = useOpenCoreStore(s => s.config);
  const setActiveModel = useOpenCoreStore(s => s.setActiveModel);
  const setModelsMenuOpen = useOpenCoreStore(s => s.setModelsMenuOpen);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'models' | 'web'>('models');

  const providers = activeProviders(cfg).filter(p => isProviderEnabled(p, cfg));
  const activeProvider = providers.find(p => p.id === cfg.activeProviderId) ?? firstConnectedProvider(cfg);
  if (!activeProvider) return null;

  const models = activeProvider.models.filter(m => isModelEnabled(activeProvider, m.id, cfg));
  const currentIsAvailable = models.some(m => m.id === cfg.activeModelId);
  const webLinks = [...BROWSER_LINKS, ...(cfg.browserBookmarks ?? [])];

  return (
    <div className="relative shrink-0">
      <button onClick={() => { setOpen(o => !o); setTab('models'); }} title="Р’С‹Р±РѕСЂ РјРѕРґРµР»Рё Рё Р±СЂР°СѓР·РµСЂРЅС‹Рµ РР"
        className="flex max-w-[190px] items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold transition-colors hover:bg-[var(--color-surface-2)]"
        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
        <Sparkles size={12} style={{ color: 'var(--color-primary)' }} />
        <span className="truncate">{currentIsAvailable ? cfg.activeModelId : activeProvider.name}</span>
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-tertiary)' }} />
      </button>
      <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full right-0 z-50 mb-2 w-64 rounded-lg border p-1.5"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>
            <div className="px-2 pt-1.5 flex items-center justify-between">
              <button onClick={() => setTab('models')} className="rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-wider transition-colors"
                style={{ color: tab === 'models' ? 'var(--color-primary)' : 'var(--color-text-tertiary)', background: tab === 'models' ? 'var(--color-surface-2)' : 'transparent' }}>
                РњРѕРґРµР»Рё
              </button>
              <button onClick={() => setTab('web')} className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-wider transition-colors"
                style={{ color: tab === 'web' ? 'var(--color-primary)' : 'var(--color-text-tertiary)', background: tab === 'web' ? 'var(--color-surface-2)' : 'transparent' }}>
                <Globe size={10} /> РР РІ Р±СЂР°СѓР·РµСЂРµ
              </button>
              <button onClick={() => setOpen(false)} title="РЎРІРµСЂРЅСѓС‚СЊ"
                className="flex h-5 w-5 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-surface-2)]"
                style={{ color: 'var(--color-text-tertiary)' }}>
                <ChevronDown size={12} className="rotate-180" />
              </button>
            </div>

            {tab === 'models' ? (
              <>
                <p className="px-2 py-1 pt-2 text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>{activeProvider.name}</p>
                <div className="max-h-44 overflow-y-auto">
                  {models.map(m => (
                    <button key={m.id} onClick={() => setActiveModel(activeProvider.id, m.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--color-surface-2)]"
                      style={{ color: cfg.activeModelId === m.id ? 'var(--color-primary)' : 'var(--color-text)' }}>
                      <div className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: cfg.activeModelId === m.id ? 'var(--color-primary)' : 'var(--color-border)' }} />
                      <span className="flex-1 truncate font-semibold">{m.name ?? m.id}</span>
                      {m.reasoning && <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>think</span>}
                    </button>
                  ))}
                </div>
                <button onClick={() => { setOpen(false); setModelsMenuOpen(true); }}
                  className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-1.5 text-[10px] font-bold transition-colors hover:opacity-80"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  <Settings2 size={11} /> РЈРїСЂР°РІР»РµРЅРёРµ РјРѕРґРµР»СЏРјРё
                </button>
              </>
            ) : (
              <>
                <p className="px-2 py-1 pt-2 text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                  Р‘СЂР°СѓР·РµСЂРЅС‹Рµ РР ({webLinks.length}) вЂ” РѕС‚РєСЂС‹РІР°СЋС‚СЃСЏ РєР»РёРєРѕРј
                </p>
                <div className="max-h-48 overflow-y-auto pb-1">
                  {webLinks.map(b => (
                    <button key={b.url} onClick={() => void invoke('open_url', { url: b.url }).catch(() => window.open(b.url, '_blank'))}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--color-surface-2)]">
                      <Globe size={11} className="shrink-0" style={{ color: 'var(--color-primary)' }} />
                      <span className="min-w-0 flex-1 truncate font-semibold" style={{ color: 'var(--color-text)' }}>{b.name}</span>
                      <ExternalLink size={10} className="shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                    </button>
                  ))}
                </div>
                <button onClick={() => { setOpen(false); setModelsMenuOpen(true); }}
                  className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-1.5 text-[10px] font-bold transition-colors hover:opacity-80"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  <Plus size={11} /> Р”РѕР±Р°РІРёС‚СЊ СЃРІРѕСЋ Р·Р°РєР»Р°РґРєСѓ
                </button>
              </>
            )}
          </motion.div>
        </>
      )}
      </AnimatePresence>
    </div>
  );
}

/** Р’С‹Р±РѕСЂ СЂР°Р±РѕС‡РµР№ СЃР±РѕСЂРєРё: В«Р‘РµР· СЃР±РѕСЂРєРёВ» РёР»Рё РєРѕРЅРєСЂРµС‚РЅР°СЏ СЃР±РѕСЂРєР° (РёРєРѕРЅРєР° + РЅР°Р·РІР°РЅРёРµ). */
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
      <button onClick={() => setOpen(o => !o)} title="РЎР±РѕСЂРєР° вЂ” СЂР°Р±РѕС‡Р°СЏ РѕР±Р»Р°СЃС‚СЊ Р°РіРµРЅС‚Р°"
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
        <span className="truncate">{active ? active.name : 'Р‘РµР· СЃР±РѕСЂРєРё'}</span>
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
              <span className="flex-1 font-semibold">Р‘РµР· СЃР±РѕСЂРєРё</span>
              {!active && <Check size={13} className="text-[var(--color-primary)]" />}
            </button>
            <p className="px-2 pt-2 pb-1 text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>РЎР±РѕСЂРєРё</p>
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
                  РЎР±РѕСЂРѕРє РїРѕРєР° РЅРµС‚. РЎРѕР·РґР°Р№ РёС… РІ СЂР°Р·РґРµР»Рµ В«Р‘РёР±Р»РёРѕС‚РµРєР°В», С‡С‚РѕР±С‹ Р°РіРµРЅС‚ РјРѕРі СЃ РЅРёРјРё СЂР°Р±РѕС‚Р°С‚СЊ.
                </p>
              )}
            </div>
            <p className="mt-1 border-t px-2.5 pt-2 text-[10px] leading-4" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}>
              РђРіРµРЅС‚ РїРѕР»СѓС‡РёС‚ РґРѕСЃС‚СѓРї Рє РїР°РїРєРµ РІС‹Р±СЂР°РЅРЅРѕР№ СЃР±РѕСЂРєРё. Р—Р°РїРёСЃСЊ вЂ” С‚РѕР»СЊРєРѕ С‡РµСЂРµР· РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ РІ РјРѕРґР°Р»РєРµ.
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
  const currentSessionId = useOpenCoreStore(s => s.currentSessionId);
  const runningSessions = useOpenCoreStore(s => s.runningSessions);
  const running = !!(currentSessionId && runningSessions[currentSessionId]);
  const cfg = useOpenCoreStore(s => s.config);
  const layout = useOpenCoreStore(s => s.layout);
  const user = useCurrentUser();

  // init() РЅРёРіРґРµ РЅРµ РІС‹Р·С‹РІР°Р»СЃСЏ: РёР·-Р·Р° СЌС‚РѕРіРѕ layout РѕСЃС‚Р°РІР°Р»СЃСЏ undefined, РІ
  // СЃРёСЃС‚РµРјРЅС‹Р№ РїСЂРѕРјРїС‚ РїРѕРїР°РґР°Р» Р±Р»РѕРє СЃ РїСѓСЃС‚РѕР№ В«РџР°РїРєР°:В», Рё Р°РіРµРЅС‚ РЅРµ Р·РЅР°Р», РіРґРµ РµРіРѕ
  // РїРµСЃРѕС‡РЅРёС†Р°. РћС‚СЃСЋРґР° Р±С‹Р»Рё РѕС‚РЅРѕСЃРёС‚РµР»СЊРЅС‹Рµ РїСѓС‚Рё Рё РїСѓСЃС‚Р°СЏ РїР°РїРєР° Projects.
  useEffect(() => { void useOpenCoreStore.getState().init(); }, []);

  const [input, setInput] = useState('');
  const [sessionFilter, setSessionFilter] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // Р§Р°С‚С‹ РіСЂСѓРїРїРёСЂСѓСЋС‚СЃСЏ РїРѕ СЃРІРµР¶РµСЃС‚Рё вЂ” РґР»РёРЅРЅС‹Р№ СЃРїРёСЃРѕРє РїРµСЂРµСЃС‚Р°С‘С‚ Р±С‹С‚СЊ СЃС‚РµРЅРѕР№.
  const sessionGroups = useMemo(() => {
    const query = sessionFilter.trim().toLowerCase();
    const visible = query ? sessions.filter(s => s.title.toLowerCase().includes(query)) : sessions;
    const day = 86_400_000;
    const now = Date.now();
    const buckets: { label: string; items: SessionMeta[] }[] = [
      { label: 'РЎРµРіРѕРґРЅСЏ', items: [] },
      { label: 'Р’С‡РµСЂР°', items: [] },
      { label: 'Р Р°РЅСЊС€Рµ', items: [] },
    ];
    for (const s of visible) {
      const age = now - s.updated;
      if (age < day) buckets[0].items.push(s);
      else if (age < day * 2) buckets[1].items.push(s);
      else buckets[2].items.push(s);
    }
    return buckets.filter(b => b.items.length > 0);
  }, [sessions, sessionFilter]);

  const abortRefs = useRef<Record<string, AbortController>>({});
  const interruptsRef = useRef<{ sessionId: string; msg: ChatMessage }[]>([]);
  /** РўСЂРѕС‚С‚Р»РёРЅРі СЃРѕС…СЂР°РЅРµРЅРёСЏ РїСЂРѕРјРµР¶СѓС‚РѕС‡РЅРѕРіРѕ РїСЂРѕРіСЂРµСЃСЃР° Р°РіРµРЅС‚Р° РЅР° РґРёСЃРє (РЅРµ С‡Р°С‰Рµ СЂР°Р·Р° РІ 1.5 СЃ). */
  const saveThrottle = useRef(0);
  const saveProgress = useCallback((sessionId?: string) => {
    const now = Date.now();
    if (now - saveThrottle.current < 1500) return;
    saveThrottle.current = now;
    void persistSession(sessionId);
  }, [persistSession]);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  /** РђРІС‚Рѕ-СЂРѕСЃС‚ РїРѕР»СЏ РІРІРѕРґР°: РґРѕ 160px, РґР°Р»СЊС€Рµ вЂ” РїСЂРѕРєСЂСѓС‚РєР°. */
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  /** Р”РµСЂР¶РёРј Р»РµРЅС‚Сѓ Сѓ РїРѕСЃР»РµРґРЅРµРіРѕ СЃРѕРѕР±С‰РµРЅРёСЏ: РїРѕРєР° Р°РіРµРЅС‚ СЂР°Р±РѕС‚Р°РµС‚ вЂ” С‚РѕР»СЊРєРѕ РµСЃР»Рё
   *  РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ СѓР¶Рµ РІРЅРёР·Сѓ; РІ РѕСЃС‚Р°Р»СЊРЅРѕРµ РІСЂРµРјСЏ РІСЃРµРіРґР° РѕРїСѓСЃРєР°РµРјСЃСЏ Рє РєРѕРЅС†Сѓ. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (running) {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    } else {
      stickRef.current = true;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, currentSessionId, running]);

  const init = useOpenCoreStore(s => s.init);
  useEffect(() => { void init(); }, [init]);

  /** РћС‚РєСЂС‹РІР°РµС‚ / РѕС‡РёС‰Р°РµС‚ РєРµС€ Р·Р°РІРёСЃРёРјРѕСЃС‚РµР№ РїРµСЃРѕС‡РЅРёС†С‹ (Cache/deps), РєРЅРѕРїРєРѕР№ РїРѕРєР°Р·С‹РІР°СЏ СЂРµР·СѓР»СЊС‚Р°С‚ РІ С‡Р°С‚Рµ. */
  const runCacheCommand = useCallback(async (clean: boolean) => {
    const append = (content: string) =>
      useOpenCoreStore.getState().appendMessages([{ id: `sys-${Date.now()}`, role: 'assistant', content, timestamp: Date.now() }]);
    try {
      const info = clean
        ? await invoke<{ root: string; deps: { name: string; path: string; size: number }[]; total_size: number }>('op_clear_cache')
        : await invoke<{ root: string; deps: { name: string; path: string; size: number }[]; total_size: number }>('op_cache_info');
      const lines = info.deps.map(d => `- \`${d.name}\` вЂ” ${fmtSize(d.size)}`).join('\n');
      const head = clean ? '**РљРµС€ Р·Р°РІРёСЃРёРјРѕСЃС‚РµР№ РѕС‡РёС‰РµРЅ.**' : '**РљРµС€ Р·Р°РІРёСЃРёРјРѕСЃС‚РµР№ РїРµСЃРѕС‡РЅРёС†С‹:**';
      append(`${head}\n\n${lines}\n\n**РЎСѓРјРјР°СЂРЅРѕ:** ${fmtSize(info.total_size)}\n\nРџР°РїРєР°: \`${info.root}\`\nРР·РѕР±СЂР°Р¶РµРЅРёСЏ (Cache/images) Рё РїСЂРѕРµРєС‚С‹ РЅРµ Р·Р°С‚СЂР°РіРёРІР°СЋС‚СЃСЏ.`);
    } catch (e) {
      append(`РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕС‡РёС‚Р°С‚СЊ РєРµС€: ${String(e)}`);
    }
  }, []);

  /** Р’С‹РїРѕР»РЅСЏРµС‚ РјРіРЅРѕРІРµРЅРЅСѓСЋ РєРѕРјР°РЅРґСѓ В«/В», РІРѕР·РІСЂР°С‰Р°РµС‚ true, РµСЃР»Рё РєРѕРјР°РЅРґР° РѕР±СЂР°Р±РѕС‚Р°РЅР°. */
  const runCommandLine = useCallback((raw: string): boolean => {
    const cmd = raw.split(/\s+/)[0].toLowerCase();
    if (cmd === '/new') { void store.newSession(); return true; }
    if (cmd === '/clear') { useOpenCoreStore.setState({ messages: [] }); return true; }
    if (cmd === '/plan' || cmd === '/build') {
      useOpenCoreStore.getState().setMode(cmd === '/plan' ? 'plan' : 'build');
      void store.newSession();
      return true;
    }
    if (cmd === '/models') { useOpenCoreStore.getState().setModelsMenuOpen(true); return true; }
    if (cmd === '/cache') { void runCacheCommand(/^\/cache\s+clean\b/i.test(raw)); return true; }
    if (cmd === '/help') {
      const msg: ChatMessage = { id: `sys-${Date.now()}`, role: 'assistant', content: HELP_TEXT, timestamp: Date.now() };
      useOpenCoreStore.getState().appendMessages([msg]);
      return true;
    }
    return false;
  }, [store]);

  const requestPermission = useCallback(async (req: PermissionRequest): Promise<'allow' | 'deny' | 'always' | 'never'> => {
    const preset = useOpenCoreStore.getState().config.permissionPreset ?? 'dfa';
    if (preset === 'ask') return 'deny';
    if (preset === 'fa') {
      if (!req.hazard) return 'always';
      // РЈСЃС‚Р°РЅРѕРІС‰РёРє (.exe/.msi) РґР°Р¶Рµ РІ FA СѓС‚РѕС‡РЅСЏРµРј Сѓ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ.
      return new Promise<'allow' | 'deny' | 'always' | 'never'>(resolve => {
        useOpenCoreStore.setState({ pendingPermission: { ...req, resolve } });
      });
    }
    const key = `${req.tool}:${req.root}`;
    const prior = useOpenCoreStore.getState().permissions[key];
    if (prior === 'always') return 'always';
    if (prior === 'never') return 'never';
    if (prior === 'once') return 'allow';

    return new Promise<'allow' | 'deny' | 'always' | 'never'>(resolve => {
      useOpenCoreStore.setState({ pendingPermission: { ...req, resolve } });
    });
  }, []);

  /** РЎР¶РёРјР°РµС‚ СЃС‚Р°СЂСѓСЋ С‡Р°СЃС‚СЊ РёСЃС‚РѕСЂРёРё РІ РєСЂР°С‚РєСѓСЋ РІС‹Р¶РёРјРєСѓ (РјРѕРґРµР»СЊСЋ), РѕСЃС‚Р°РІР»СЏСЏ РїРѕСЃР»РµРґРЅРёРµ СЃРѕРѕР±С‰РµРЅРёСЏ РєР°Рє РµСЃС‚СЊ. */
  const compressChat = useCallback(async () => {
    const st = useOpenCoreStore.getState();
    const all = st.messages;
    if (all.length < 8) {
      st.appendMessages([{ id: `sys-${Date.now()}`, role: 'assistant', content: 'РСЃС‚РѕСЂРёСЏ Рё С‚Р°Рє РєРѕСЂРѕС‚РєР°СЏ вЂ” СЃР¶РёРјР°С‚СЊ РЅРµС‡РµРіРѕ.', timestamp: Date.now() }]);
      return;
    }
    const sid = st.currentSessionId;
    if (!sid) return;
    const cfgNow = st.config;
    const activePt = activeProviders(cfgNow).find(p => p.id === cfgNow.activeProviderId && isProviderEnabled(p, cfgNow) && p.models.length > 0) ?? firstConnectedProvider(cfgNow);
    if (!activePt || activePt.models.length === 0) {
      st.appendMessages([{ id: `sys-${Date.now()}`, role: 'assistant', content: 'РќРµС‚ РїРѕРґРєР»СЋС‡С‘РЅРЅРѕРіРѕ РїСЂРѕРІР°Р№РґРµСЂР° РґР»СЏ СЃР¶Р°С‚РёСЏ.', timestamp: Date.now() }]);
      return;
    }
    const modelId = cfgNow.activeModelId || activePt.models[0].id;
    const keep = all.slice(-6);
    const older = all.filter(m => !m.summary).slice(0, all.length - keep.length);
    const transcript = older
      .map(m => `${m.role === 'user' ? 'РџРћР›Р¬Р—РћР’РђРўР•Р›Р¬' : m.role === 'assistant' ? 'РђР“Р•РќРў' : 'РРќРЎРўР РЈРњР•РќРў'}: ${m.content}`)
      .join('\n\n')
      .slice(0, 80_000);
    const ep = resolveEndpoint(activePt.id, modelId, cfgNow.providers, cfgNow.modelContexts);
    ep.serviceTokens = cfgNow.serviceTokens ?? {};
    const notice: ChatMessage = { id: `sys-${Date.now()}`, role: 'assistant', content: 'РЎР¶РёРјР°СЋ РёСЃС‚РѕСЂРёСЋвЂ¦', timestamp: Date.now() };
    st.appendMessages([notice]);
    st.setSessionRunning(sid, true);
    try {
      const outcome = await callProvider(
        ep,
        'РўС‹ СЃР¶РёРјР°РµС€СЊ РґР»РёРЅРЅСѓСЋ РїРµСЂРµРїРёСЃРєСѓ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ Рё Р°РіРµРЅС‚Р° РІ РџРћР”Р РћР‘РќРЈР®, РЅРѕ РєРѕРјРїР°РєС‚РЅСѓСЋ РІС‹Р¶РёРјРєСѓ, РєРѕС‚РѕСЂР°СЏ РїРѕР»РЅРѕСЃС‚СЊСЋ Р·Р°РјРµРЅРёС‚ РѕСЂРёРіРёРЅР°Р». РЎРѕСЃС‚Р°РІСЊ СЂР°Р·РґРµР»С‹:\n' +
          '## Р¦РµР»СЊ вЂ” РєРѕСЂРѕС‚РєРѕ, С‡С‚Рѕ РїСЂРѕСЃРёР» РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ.\n' +
          '## Р§С‚Рѕ СЃРґРµР»Р°РЅРѕ вЂ” РїРѕ РїСѓРЅРєС‚Р°Рј: С„Р°Р№Р»С‹ Рё РїСѓС‚Рё, СѓСЃС‚Р°РЅРѕРІР»РµРЅРЅС‹Рµ РјРѕРґС‹ (СЃ id Рё РёРјРµРЅР°РјРё), РІС‹РїРѕР»РЅРµРЅРЅС‹Рµ С€Р°РіРё, СЂРµР·СѓР»СЊС‚Р°С‚С‹.\n' +
          '## РРЅС„РѕСЂРјР°С†РёСЏ вЂ” С‚РѕС‡РЅС‹Рµ С„Р°РєС‚С‹, РІРµСЂСЃРёРё, СЃСЃС‹Р»РєРё, Р·РЅР°С‡РµРЅРёСЏ.\n' +
          '## Р РµС€РµРЅРёСЏ вЂ” РІС‹Р±РѕСЂС‹, РєРѕС‚РѕСЂС‹Рµ РЅРµР»СЊР·СЏ Р·Р°Р±С‹РІР°С‚СЊ.\n' +
          '## РћС‚РєСЂС‹С‚С‹Рµ Р·Р°РґР°С‡Рё вЂ” С‡С‚Рѕ РѕСЃС‚Р°Р»РѕСЃСЊ, С‡С‚Рѕ РґРµР»Р°С‚СЊ РґР°Р»СЊС€Рµ.\n' +
          'РџРёС€Рё РЅР° СЏР·С‹РєРµ РїРµСЂРµРїРёСЃРєРё, СЃРѕС…СЂР°РЅРё РІР°Р¶РЅС‹Рµ РґРµС‚Р°Р»Рё (РёРјРµРЅР°, РїСѓС‚Рё, id, РІРµСЂСЃРёРё, СЂРµС€РµРЅРёСЏ). РћС‚РІРµС‚СЊ РўРћР›Р¬РљРћ С‚РµРєСЃС‚РѕРј РІС‹Р¶РёРјРєРё, РёРЅСЃС‚СЂСѓРјРµРЅС‚С‹ РЅРµ РІС‹Р·С‹РІР°Р№.',
        [{ role: 'user', content: transcript }],
      );
      const summary = (outcome.text || '').trim() || '(РјРѕРґРµР»СЊ РЅРµ РІРµСЂРЅСѓР»Р° С‚РµРєСЃС‚ РІС‹Р¶РёРјРєРё)';
      const summaryMsg: ChatMessage = {
        id: `summary-${Date.now()}`, role: 'assistant',
        content: `**РЎР¶Р°С‚Р°СЏ РёСЃС‚РѕСЂРёСЏ** (${older.length} СЃРѕРѕР±С‰РµРЅРёР№ СЃРІС‘СЂРЅСѓС‚Рѕ)\n\n${summary}`,
        timestamp: Date.now(),
        summary: true,
      };
      useOpenCoreStore.setState({ messages: [summaryMsg, ...keep] });
    } catch (e) {
      useOpenCoreStore.getState().updateMessage(notice.id, { content: `РќРµ СѓРґР°Р»РѕСЃСЊ СЃР¶Р°С‚СЊ РёСЃС‚РѕСЂРёСЋ: ${e instanceof Error ? e.message : String(e)}`, error: true });
    } finally {
      useOpenCoreStore.getState().setSessionRunning(sid, false);
      void persistSession(sid);
    }
  }, []);

  async function persistSession(targetId?: string) {
    const sid = targetId ?? useOpenCoreStore.getState().currentSessionId;
    if (!sid) return;
    const msgs = useOpenCoreStore.getState().readSessionMessages(sid);
    const cfgNow = useOpenCoreStore.getState().config;
    const firstUser = msgs.find(m => m.role === 'user');
    const title = firstUser ? firstUser.content.replace(/\s+/g, ' ').slice(0, 60) : 'РќРѕРІР°СЏ СЃРµСЃСЃРёСЏ';
    const data: SessionData = {
      id: sid,
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
      await invoke('op_save_session', { sessionId: sid, payload: JSON.stringify(data) });
      // РћР±РЅРѕРІРёС‚СЊ Р·Р°РіРѕР»РѕРІРѕРє РІ СЃРїРёСЃРєРµ
      useOpenCoreStore.setState({
        sessions: useOpenCoreStore.getState().sessions.map(s => s.id === sid
          ? { ...s, title, updated: data.updated, message_count: msgs.length }
          : s),
      });
    } catch (e) {
      console.error('[OpenPortal] save session failed', e);
    }
  }

  const send = useCallback(async (overrideText?: string) => {
    const isOverride = typeof overrideText === 'string';
    let text = (overrideText ?? input).trim();
    if (!text) return;
    if (!isOverride) setInput('');

    const live = useOpenCoreStore.getState();
    const liveSession = live.currentSessionId;
    const liveRunning = !!liveSession && !!live.runningSessions[liveSession];
    if (liveRunning) {
      // РђРіРµРЅС‚ Р·Р°РЅСЏС‚ С‚РµРєСѓС‰РµР№ Р·Р°РґР°С‡РµР№: СЃРѕРѕР±С‰РµРЅРёРµ РґРѕСЃС‚Р°РІР»СЏРµРј СЃСЂР°Р·Сѓ вЂ” СЌС‚Рѕ РїСЂРµСЂС‹РІР°РЅРёРµ,
      // Р°РіРµРЅС‚ РїРѕРґС…РІР°С‚РёС‚ РµРіРѕ РїРѕСЃР»Рµ С‚РµРєСѓС‰РµРіРѕ С€Р°РіР° Рё РїСЂРѕРґРѕР»Р¶РёС‚ СЂР°Р±РѕС‚Сѓ РЅР°Рґ РЅРѕРІРѕР№ Р·Р°РґР°С‡РµР№.
      if (liveSession) {
        const now = Date.now();
        const userMsg: ChatMessage = {
          id: `user-${now}`, role: 'user', content: text, timestamp: now,
        };
        live.appendSessionMessages(liveSession, [userMsg]);
        interruptsRef.current.push({ sessionId: liveSession, msg: userMsg });
      }
      if (!isOverride) setAttachments([]);
      return;
    }

    // РљРѕРјР°РЅРґС‹ "/"
    let taskDirective: string | undefined;
    if (text.startsWith('/')) {
      const cmd = text.split(/\s+/)[0].toLowerCase();
      const arg = text.slice(cmd.length).trim();
      if (runCommandLine(text)) return;
      if (cmd === '/continue') {
        const sid = useOpenCoreStore.getState().currentSessionId;
        const msgs = sid ? useOpenCoreStore.getState().readSessionMessages(sid) : [];
        const lastUser = [...msgs].reverse().find(m => m.role === 'user' && m.id.startsWith('user-'));
        if (!lastUser) {
          const m: ChatMessage = { id: `sys-${Date.now()}`, role: 'assistant', content: 'РќРµС‚ РїСЂРµСЂРІР°РЅРЅРѕРіРѕ Р·Р°РїСЂРѕСЃР° вЂ” РёСЃС‚РѕСЂРёСЏ РїСѓСЃС‚Р°.', timestamp: Date.now() };
          useOpenCoreStore.getState().appendMessages([m]);
          return;
        }
        void send(lastUser.content);
        return;
      }
      if (cmd === '/compress') { await compressChat(); return; }
      if (cmd === '/context') {
        const u = useOpenCoreStore.getState().usage;
        const lim = u.limit || 128_000;
        const pct = Math.min(100, Math.round((u.context / lim) * 100));
        const m: ChatMessage = {
          id: `sys-${Date.now()}`, role: 'assistant', timestamp: Date.now(),
          content: `**РљРѕРЅС‚РµРєСЃС‚**: ${u.context} / ${lim} С‚РѕРєРµРЅРѕРІ (${pct}%)${u.estimated ? ' вЂ” РѕС†РµРЅРєР°' : ''}\n` +
            `**Р—Р° СЃРµСЃСЃРёСЋ**: ${u.input} РІС…РѕРґ В· ${u.output} РІС‹С…РѕРґ В· ${u.input + u.output} РІСЃРµРіРѕ` +
            (pct >= 70 ? '\n\nРСЃС‚РѕСЂРёСЏ РїСЂРёР±Р»РёР¶Р°РµС‚СЃСЏ Рє Р»РёРјРёС‚Сѓ вЂ” РЅР°Р¶РјРё В«РЎР¶Р°С‚СЊ РёСЃС‚РѕСЂРёСЋВ» РІ РёРЅРґРёРєР°С‚РѕСЂРµ РєРѕРЅС‚РµРєСЃС‚Р° РёР»Рё РѕС‚РїСЂР°РІСЊ `/compress`.' : ''),
        };
        useOpenCoreStore.getState().appendMessages([m]);
        return;
      }
      if (cmd === '/skill-creator' || cmd === '/skill-installer') {
        if (!arg) {
          const msg: ChatMessage = {
            id: `sys-${Date.now()}`, role: 'assistant',
            content: cmd === '/skill-creator'
              ? 'РћРїРёС€Рё РЅР°РІС‹Рє: `/skill-creator <РѕРїРёСЃР°РЅРёРµ>`'
              : 'РЈРєР°Р¶Рё РёРјСЏ/СЃСЃС‹Р»РєСѓ: `/skill-installer <С‡С‚Рѕ РёС‰РµРј>`',
            timestamp: Date.now(),
          };
          useOpenCoreStore.getState().appendMessages([msg]);
          return;
        }
        if (cmd === '/skill-creator') {
          taskDirective = `РўС‹ Р·Р°РїСѓС‰РµРЅ РєРѕРјР°РЅРґРѕР№ /skill-creator. Р—Р°РґР°С‡Р°: СЃРѕР·РґР°С‚СЊ РЅРѕРІС‹Р№ РЅР°РІС‹Рє РґР»СЏ Р°РіРµРЅС‚Р° В«${arg}В». РќР°РІС‹Рє вЂ” РїР°РїРєР° <portal base>/Skills/<slug>/SKILL.md СЃ frontmatter (name, description) Рё РёРЅСЃС‚СЂСѓРєС†РёСЏРјРё. РСЃРїРѕР»СЊР·СѓР№ write_text.`;
          text = `РљРѕРјР°РЅРґР° /skill-creator: СЃРѕР·РґР°Р№ РЅР°РІС‹Рє В«${arg}В» Рё СЃРѕС…СЂР°РЅРё РµРіРѕ SKILL.md РІ РїР°РїРєРµ РЅР°РІС‹РєРѕРІ.`;
        } else {
          taskDirective = `РўС‹ Р·Р°РїСѓС‰РµРЅ РєРѕРјР°РЅРґРѕР№ /skill-installer. Р—Р°РґР°С‡Р°: РЅР°Р№С‚Рё РІ РёРЅС‚РµСЂРЅРµС‚Рµ (web_search) РЅР°РІС‹Рє В«${arg}В», СЃРєР°С‡Р°С‚СЊ СЃРѕРґРµСЂР¶РёРјРѕРµ Рё СѓСЃС‚Р°РЅРѕРІРёС‚СЊ РєР°Рє <portal base>/Skills/<slug>/SKILL.md СЃ frontmatter (name, description).`;
          text = `РљРѕРјР°РЅРґР° /skill-installer: РЅР°Р№РґРё РїРѕРґС…РѕРґСЏС‰РёР№ РЅР°РІС‹Рє В«${arg}В», СѓСЃС‚Р°РЅРѕРІРё РµРіРѕ SKILL.md РІ РїР°РїРєСѓ РЅР°РІС‹РєРѕРІ Рё РєСЂР°С‚РєРѕ РѕР±СЉСЏСЃРЅРё, С‡С‚Рѕ РѕРЅ РґРµР»Р°РµС‚.`;
        }
      } else {
        const skill = store.skills.find(s => s.name && `/${s.name.toLowerCase()}` === cmd);
        if (skill) {
          taskDirective = `РўС‹ Р·Р°РїСѓС‰РµРЅ РЅР°РІС‹РєРѕРј В«${skill.name}В». РћР±СЏР·Р°С‚РµР»СЊРЅРѕ СЃРЅР°С‡Р°Р»Р° РїСЂРѕС‡РёС‚Р°Р№ РµРіРѕ РёРЅСЃС‚СЂСѓРєС†РёРё (read_text root=portal, РїСѓС‚СЊ Skills/${skill.name}/SKILL.md) Рё СЃС‚СЂРѕРіРѕ СЃР»РµРґСѓР№ РёРј: ${arg || 'РІС‹РїРѕР»РЅРё Р·Р°РґР°С‡Сѓ РїРѕ РѕРїРёСЃР°РЅРёСЋ РЅР°РІС‹РєР°'}.`;
          text = arg ? `Р’С‹РїРѕР»РЅРё Р·Р°РґР°С‡Сѓ РЅР°РІС‹РєР° В«${skill.name}В»: ${arg}` : `Р’С‹РїРѕР»РЅРё Р·Р°РґР°С‡Сѓ СЃРѕРіР»Р°СЃРЅРѕ РЅР°РІС‹РєСѓ В«${skill.name}В».`;
        } else {
          const unknown: ChatMessage = { id: `sys-${Date.now()}`, role: 'assistant', content: `РќРµРёР·РІРµСЃС‚РЅР°СЏ РєРѕРјР°РЅРґР° **${cmd}**. РќР°Р±РµСЂРё /help`, timestamp: Date.now() };
          useOpenCoreStore.getState().appendMessages([unknown]);
          return;
        }
      }
    }

    // РўРѕР»СЊРєРѕ РїРѕРґРєР»СЋС‡С‘РЅРЅС‹Рµ РїСЂРѕРІР°Р№РґРµСЂС‹: РµСЃР»Рё Р°РєС‚РёРІРЅС‹Р№ РІС‹РєР»СЋС‡РµРЅ/РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚ вЂ” РїРµСЂРµРєР»СЋС‡Р°РµРјСЃСЏ РЅР° РїРѕРґРєР»СЋС‡С‘РЅРЅС‹Р№.
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
          content: 'РќРµС‚ РїРѕРґРєР»СЋС‡С‘РЅРЅРѕРіРѕ РїСЂРѕРІР°Р№РґРµСЂР°. РћС‚РєСЂРѕР№ В«РЈРїСЂР°РІР»РµРЅРёРµ РјРѕРґРµР»СЏРјРёВ» Рё РїРѕРґРєР»СЋС‡Рё РїСЂРѕРІР°Р№РґРµСЂР° вЂ” РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ СЂР°Р±РѕС‚Р°РµС‚ Р±РµСЃРїР»Р°С‚РЅС‹Р№ OpenCode Zen.',
          timestamp: Date.now(),
        };
        useOpenCoreStore.getState().appendMessages([sysMsg]);
        useOpenCoreStore.getState().setModelsMenuOpen(true);
        return;
      }
    }

    // РЎРѕР·РґР°С‚СЊ СЃРµСЃСЃРёСЋ С‚РѕР»СЊРєРѕ РµСЃР»Рё С‡Р°С‚ РѕС‚РєСЂС‹С‚ СЃ РЅСѓР»СЏ; РёРЅР°С‡Рµ РёСЃРїРѕР»СЊР·СѓРµРј С‚РµРєСѓС‰СѓСЋ Рё РїРµСЂРµРёРјРµРЅСѓРµРј РµС‘ РїСЂРё СЃРѕС…СЂР°РЅРµРЅРёРё.
    let sessionId = store.currentSessionId;
    if (!sessionId) {
      await store.newSession();
      sessionId = useOpenCoreStore.getState().currentSessionId;
    }
    const runSessionId = sessionId;
    if (!runSessionId) return;

    // Р’Р»РѕР¶РµРЅРёСЏ Р·Р°С€РёРІР°РµРј РІ С‚РµРєСЃС‚: РєР°СЂС‚РёРЅРєРё Р°РЅР°Р»РёР·РёСЂСѓРµРј РїРѕ РїРёРєСЃРµР»СЏРј (РїР°Р»РёС‚СЂР°) С‡РµСЂРµР·
    // op_image_inspect, С‚РµРєСЃС‚РѕРІС‹Рµ С„Р°Р№Р»С‹ РІСЃС‚СЂР°РёРІР°РµРј, РѕСЃС‚Р°Р»СЊРЅС‹Рµ вЂ” СѓРїРѕРјРёРЅР°РЅРёРµ. base64
    // РјРѕРґРµР»Рё РќР• РїРµСЂРµРґР°С‘Рј (РёРЅР°С‡Рµ РїСЂРѕРІР°Р№РґРµСЂ zen РІРѕР·РІСЂР°С‰Р°Р» HTTP 500 Рё С‡Р°С‚ Р»РѕРјР°Р»СЃСЏ).
    let finalText = text;
    if (attachments.length > 0) {
      const parts: string[] = [];
      for (const a of attachments) {
        const b64 = a.base64 ?? (a.dataUrl ? a.dataUrl.split(',')[1] ?? '' : '');
        if (a.type?.startsWith('image/') && b64) {
          try {
            const imgName = await invoke<string>('op_save_image', { b64 });
            const insp = await invoke<{
              width: number; height: number; alpha: boolean;
              colors: { hex: string; share: number; brightness: number }[];
              dominant: string; average: string;
            }>('op_image_inspect', { root: 'portal', path: `${layout?.cache ?? ''}\\images\\${imgName}` });
            const palette = (Array.isArray(insp?.colors) ? insp.colors : [])
              .map(c => `${c.hex} ${Math.round((c.share ?? 0) * 10) / 10}%`)
              .slice(0, 6).join(', ');
            parts.push(`[Р’Р»РѕР¶РµРЅРёРµ вЂ” РёР·РѕР±СЂР°Р¶РµРЅРёРµ В«${a.name}В»] ${insp?.width ?? '?'}Г—${insp?.height ?? '?'} px, РїСЂРѕР·СЂР°С‡РЅРѕСЃС‚СЊ: ${insp?.alpha ? 'РµСЃС‚СЊ' : 'РЅРµС‚'}, РґРѕРјРёРЅРёСЂСѓСЋС‰РёР№ С†РІРµС‚ ${insp?.dominant || 'вЂ”'}, СЃСЂРµРґРЅРёР№ С†РІРµС‚ ${insp?.average || 'вЂ”'}, РїР°Р»РёС‚СЂР°: ${palette || 'вЂ”'}.`);
          } catch {
            parts.push(`[Р’Р»РѕР¶РµРЅРёРµ вЂ” РёР·РѕР±СЂР°Р¶РµРЅРёРµ В«${a.name}В»] (РЅРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕР°РЅР°Р»РёР·РёСЂРѕРІР°С‚СЊ)`);
          }
        } else if (a.type?.startsWith('text/') && b64 && b64.length < 70_000) {
          try {
            parts.push(`[Р’Р»РѕР¶РµРЅРёРµ вЂ” С„Р°Р№Р» В«${a.name}В»]\n\`\`\`\n${b64ToUtf8(b64).slice(0, 50_000)}\n\`\`\``);
          } catch {
            parts.push(`[Р’Р»РѕР¶РµРЅРёРµ вЂ” С„Р°Р№Р» В«${a.name}В»] (${fmtSize(a.size)}, ${a.type || 'Р±РёРЅР°СЂРЅС‹Р№'})`);
          }
        } else {
          parts.push(`[Р’Р»РѕР¶РµРЅРёРµ вЂ” С„Р°Р№Р» В«${a.name}В»] (${fmtSize(a.size)}, ${a.type || 'Р±РёРЅР°СЂРЅС‹Р№'})`);
        }
      }
      if (parts.length > 0) finalText = `${text}\n\n${parts.join('\n\n')}`;
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`, role: 'user', content: finalText, attachments: attachments.length ? attachments : undefined, timestamp: Date.now(),
    };
    useOpenCoreStore.getState().appendSessionMessages(runSessionId, [userMsg]);
    setAttachments([]);

    const mode: 'build' | 'plan' = taskDirective ? 'build' : cfg.mode;
    const ep = resolveEndpoint(providerId, modelId, cfgNow.providers, cfgNow.modelContexts);
    ep.serviceTokens = useOpenCoreStore.getState().config.serviceTokens ?? {};
    ep.onSetToken = (host, token) => useOpenCoreStore.getState().setServiceToken(host, token);
    ep.imageGenProvider = cfgNow.imageGenProvider ?? 'stable_horde';

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
      } catch { /* РїР°РїРєР° СЃР±РѕСЂРєРё РЅРµ РѕРїСЂРµРґРµР»РёР»Р°СЃСЊ вЂ” РѕСЃС‚Р°С‘РјСЃСЏ РЅР° portal */ }
    }
    const extraBase = layout
      ? `РРіСЂРѕРє (Minecraft-РЅРёРє): ${user?.username || 'РёРіСЂРѕРє'}\nР Р°Р±РѕС‡Р°СЏ РѕР±Р»Р°СЃС‚СЊ Р°РіРµРЅС‚Р°: ${workspaceLabel}${workspaceZone === 'launcher' ? ' (СЃР±РѕСЂРєР°)' : ''}\nРџР°РїРєР°: ${workspaceDir}\nРџСЂР°РІР°: ${workspaceZone === 'launcher' ? 'С‡С‚РµРЅРёРµ Р»Р°СѓРЅС‡РµСЂР° РІРµР·РґРµ; Р·Р°РїРёСЃСЊ вЂ” С‚РѕР»СЊРєРѕ РІ РїР°РїРєСѓ СЃР±РѕСЂРєРё Рё РІ settings.json' : 'РїРѕР»РЅС‹Р№ РґРѕСЃС‚СѓРї РІРЅСѓС‚СЂРё OpenPortal Projects'}${workspaceZone === 'portal' ? `\nРџР•РЎРћР§РќРР¦Рђ: СЌС‚Рѕ С‚РІРѕСЏ СЂР°Р±РѕС‡Р°СЏ РїР°РїРєР°. РћС‚РЅРѕСЃРёС‚РµР»СЊРЅС‹Рµ РїСѓС‚Рё (РЅР°РїСЂРёРјРµСЂ src/main/java/Mod.java, notes.md, assets/pack.png) СЃС‡РёС‚Р°СЋС‚СЃСЏ РѕС‚ РЅРµС‘ вЂ” СЃРѕР·РґР°РІР°Р№ РїСЂРѕРµРєС‚С‹ РїСЂСЏРјРѕ Р·РґРµСЃСЊ, РѕС‚РґРµР»СЊРЅРѕР№ РїР°РїРєРѕР№ РЅР° РїСЂРѕРµРєС‚ (РЅР°РїСЂРёРјРµСЂ shader-optics/, my-mod/). Р’Р»РѕР¶РµРЅРЅС‹Рµ РїР°РїРєРё СЃРѕР·РґР°СЋС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё, РјРѕР¶РµС€СЊ РїРёСЃР°С‚СЊ СЃСЂР°Р·Сѓ РІРіР»СѓР±СЊ. Р’СЃС‘, С‡С‚Рѕ С‚С‹ Р·РґРµСЃСЊ СЃРѕР·РґР°С‘С€СЊ Рё СЃРєР°С‡РёРІР°РµС€СЊ, СЃРѕС…СЂР°РЅСЏРµС‚СЃСЏ Рё РґРѕСЃС‚СѓРїРЅРѕ РІ СЃР»РµРґСѓСЋС‰РёС… СЃРµСЃСЃРёСЏС….` : ''}\nР’СЂРµРјРµРЅРЅР°СЏ (Temp): ${layout.temp}\nРљР°С‚Р°Р»РѕРі Р»Р°СѓРЅС‡РµСЂР°: ${layout.launcher}\nРџРѕСЂС‚Р°Р» (OpenPortal): ${layout.base}\nРђРєС‚РёРІРЅР°СЏ РјРѕРґРµР»СЊ: ${modelId} (${ep.provider.name}).`
      : undefined;
    const extra = taskDirective && extraBase
      ? `${extraBase}\nРџР°РїРєР° РЅР°РІС‹РєРѕРІ Р°РіРµРЅС‚Р°: ${layout?.base}\\Skills`
      : extraBase;
    const skills = store.skills.length
      ? store.skills.map(s => `- ${s.name} вЂ” ${s.description || 'РЅРµС‚ РѕРїРёСЃР°РЅРёСЏ'}`).join('\n')
      : undefined;
    const systemPrompt = buildSystemPrompt({
      mode,
      extra: taskDirective ? `${extra ?? ''}\n\n${taskDirective}`.trim() : extra,
      skills,
      // Р‘РµР· РјРѕРґРµР»Рё/РѕРєРЅР° РєРѕРЅС‚РµРєСЃС‚Р° РїСЂРѕРјРїС‚ Р±С‹Р» РѕРґРёРЅР°РєРѕРІ РґР»СЏ РІСЃРµС… РјРѕРґРµР»РµР№ вЂ”
      // Р°РіРµРЅС‚ РЅРµ Р·РЅР°Р» СЃРІРѕР№ Р±СЋРґР¶РµС‚ Рё РѕРґРёРЅР°РєРѕРІРѕ РїС‹С‚Р°Р»СЃСЏ СѓРґРµСЂР¶РёРІР°С‚СЊ РёСЃС‚РѕСЂРёСЋ.
      model: ep.model.id,
      contextLimit: contextWindow(ep.model, ep.provider.id),
    });

    const abort = new AbortController();
    abortRefs.current[runSessionId] = abort;
    useOpenCoreStore.getState().setSessionRunning(runSessionId, true);

    const ctxLimit = contextWindow(ep.model, providerId);
    if (runSessionId === useOpenCoreStore.getState().currentSessionId) useOpenCoreStore.getState().setContextLimit(ctxLimit);

    try {
      const currentMsgs = useOpenCoreStore.getState().readSessionMessages(runSessionId);
      const history = compressHistory(currentMsgs, 36);
      const preset = cfgNow.permissionPreset ?? 'dfa';
      await runAgentTurn({
        ep,
        systemPrompt,
        input: history,
        mode,
        contextLimit: ctxLimit,
        effort: cfgNow.effort,
        requestPermission,
        policy: preset === 'ask' ? 'ask' : undefined,
        interrupt: async () => {
          const q = interruptsRef.current;
          const i = q.findIndex(x => x.sessionId === runSessionId);
          if (i < 0) return null;
          const [item] = q.splice(i, 1);
          return item.msg;
        },
        signal: abort.signal,
        // РЎРѕС…СЂР°РЅСЏРµРј С…РѕРґ СЂР°Р±РѕС‚С‹ РЅР° РґРёСЃРє РїРѕ С…РѕРґСѓ turn'Р° (СЃ С‚СЂРѕС‚С‚Р»РёРЅРіРѕРј), С‡С‚РѕР±С‹ РїСЂРё
        // Р·Р°РєСЂС‹С‚РёРё Р»Р°СѓРЅС‡РµСЂР° С‡Р°СЃС‚РёС‡РЅРѕ РІС‹РїРѕР»РЅРµРЅРЅС‹Р№ Р·Р°РїСЂРѕСЃ РЅРµ РїСЂРѕРїР°РґР°Р».
        onAppend: msgs => {
          useOpenCoreStore.getState().appendSessionMessages(runSessionId, msgs);
          saveProgress(runSessionId);
        },
        onUpdate: (id, patch) => {
          useOpenCoreStore.getState().updateSessionMessage(runSessionId, id, patch);
          saveProgress(runSessionId);
        },
        onReplace: msgs => {
          useOpenCoreStore.getState().replaceSessionMessages(runSessionId, msgs);
          saveProgress(runSessionId);
        },
        onUsage: u => { if (runSessionId === useOpenCoreStore.getState().currentSessionId) useOpenCoreStore.getState().addUsage(u); },
      });
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      const msg: ChatMessage = {
        id: `err-${Date.now()}`, role: 'assistant',
        content: err.startsWith('РћС‚РјРµРЅРµРЅРѕ') ? 'Р—Р°РґР°С‡Р° РѕСЃС‚Р°РЅРѕРІР»РµРЅР° РІР°РјРё.' : `РћС€РёР±РєР°: ${err}`,
        error: true, timestamp: Date.now(),
      };
      useOpenCoreStore.getState().appendSessionMessages(runSessionId, [msg]);
    } finally {
      useOpenCoreStore.getState().setSessionRunning(runSessionId, false);
      delete abortRefs.current[runSessionId];
      interruptsRef.current = interruptsRef.current.filter(x => x.sessionId !== runSessionId);
      void persistSession(runSessionId);
      // РќР°РІС‹РєРё Рё СЃР±РѕСЂРєРё РјРѕРіР»Р° СЃРѕР·РґР°С‚СЊ СЃР°РјР° РјРѕРґРµР»СЊ вЂ” РѕР±РЅРѕРІРё СЃРїРёСЃРєРё, С‡С‚РѕР±С‹ РѕРЅРё РїРѕСЏРІРёР»РёСЃСЊ СЃСЂР°Р·Сѓ.
      void useOpenCoreStore.getState().refreshSkills();
      void (async () => {
        try {
          const insts = await invoke<any[]>('op_list_instances');
          useInstanceStore.getState().syncFromBackend(insts);
        } catch { /* РЅРµ РєСЂРёС‚РёС‡РЅРѕ */ }
      })();
    }
  }, [input, running, store, cfg, layout, attachments, requestPermission, user?.username, compressChat, persistSession, saveProgress]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  const cmdOpen = !running && input.startsWith('/');
  const cmdQuery = input.slice(1).toLowerCase();
  const allCommands = [
    ...COMMANDS,
    ...store.skills.filter(s => s.name).map(s => ({ cmd: `/${s.name}`, desc: s.description || 'РќР°РІС‹Рє', instant: false as const })),
  ];
  const cmdList = cmdOpen ? allCommands.filter(c => c.cmd.slice(1).toLowerCase().includes(cmdQuery)) : [];
  const lastAssistantId = [...messages].reverse().find(m => m.role === 'assistant' && m.content)?.id;

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
      <aside className="flex w-64 shrink-0 flex-col border-r" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="flex items-center gap-2.5 px-3.5 pt-3.5 pb-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[11px] font-black"
            style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>OP</div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[13px] font-black leading-4" style={{ color: 'var(--color-text)' }}>OpenPortal</h2>
            <p className="truncate text-[10px] leading-3" style={{ color: 'var(--color-text-tertiary)' }}>
              {sessions.length > 0 ? `${sessions.length} ${plural(sessions.length, 'С‡Р°С‚', 'С‡Р°С‚Р°', 'С‡Р°С‚РѕРІ')}` : 'РСЃС‚РѕСЂРёСЏ РїСѓСЃС‚Р°'}
            </p>
          </div>
          <button onClick={() => void store.newSession()} title="РќРѕРІС‹Р№ С‡Р°С‚"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--color-surface-2)]"
            style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
            <Plus size={14} />
          </button>
        </div>
        <div className="px-3 pb-2">
          <div className="flex items-center gap-1.5 rounded px-2 py-1.5"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
            <Search size={12} className="shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
            <input
              value={sessionFilter}
              onChange={e => setSessionFilter(e.target.value)}
              placeholder="РџРѕРёСЃРє РїРѕ С‡Р°С‚Р°Рј"
              className="min-w-0 flex-1 bg-transparent text-[11px] outline-none"
              style={{ color: 'var(--color-text)' }}
            />
            {sessionFilter && (
              <button onClick={() => setSessionFilter('')} title="РћС‡РёСЃС‚РёС‚СЊ" style={{ color: 'var(--color-text-tertiary)' }}>
                <X size={11} />
              </button>
            )}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
          {sessionGroups.map(group => (
            <div key={group.label} className="mb-1">
              <p className="px-2 py-1 text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>{group.label}</p>
              {group.items.map(s => {
                const active = s.id === currentSessionId;
                return (
                  <button key={s.id} onClick={() => void store.openSession(s.id)}
                    className="group relative flex w-full items-center gap-2 rounded py-2 pl-2.5 pr-1.5 text-left transition-colors hover:bg-[var(--color-surface-2)]"
                    style={active ? { background: 'var(--color-surface-2)' } : undefined}>
                    {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full" style={{ background: 'var(--color-primary)' }} />}
                    {runningSessions[s.id]
                      ? <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-[var(--color-primary)] border-t-transparent" />
                      : <MessageSquare size={12} className="shrink-0" style={{ color: active ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }} />}
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-4" style={{ color: active ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>{s.title}</span>
                    <span className="hidden shrink-0 group-hover:inline-block" onClick={e => { e.stopPropagation(); void store.deleteSession(s.id); }}>
                      <Trash2 size={11} style={{ color: 'var(--color-text-tertiary)' }} />
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="px-2.5 py-3 text-[11px] leading-5" style={{ color: 'var(--color-text-tertiary)' }}>Р§Р°С‚РѕРІ РїРѕРєР° РЅРµС‚. РќР°Р¶РјРё В«+В», С‡С‚РѕР±С‹ РЅР°С‡Р°С‚СЊ РЅРѕРІСѓСЋ СЃРµСЃСЃРёСЋ.</p>
          )}
          {sessions.length > 0 && sessionGroups.length === 0 && (
            <p className="px-2.5 py-3 text-[11px] leading-5" style={{ color: 'var(--color-text-tertiary)' }}>РќРёС‡РµРіРѕ РЅРµ РЅР°Р№РґРµРЅРѕ РїРѕ Р·Р°РїСЂРѕСЃСѓ В«{sessionFilter}В».</p>
          )}
        </div>
        <div className="border-t p-2" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={() => navigate('/home')}
            className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-[12px] font-bold transition-colors hover:bg-[var(--color-surface-2)]"
            style={{ color: 'var(--color-text-secondary)' }}>
            <ChevronLeft size={13} /> Р’ Р»Р°СѓРЅС‡РµСЂ
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="ore-plain flex items-center gap-3 border-b px-5 py-3" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <Bot size={15} style={{ color: 'var(--color-primary)' }} />
            <span className="text-xs font-black" style={{ color: 'var(--color-text)' }}>OpenPortal</span>
          </div>
          <span
            className="flex items-center gap-1.5 text-[10px] font-bold"
            title={running ? 'РђРіРµРЅС‚ РІС‹РїРѕР»РЅСЏРµС‚ Р·Р°РґР°С‡Сѓ' : 'РђРіРµРЅС‚ СЃРІРѕР±РѕРґРµРЅ'}
            style={{ color: running ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>
            {running
              ? <><span className="h-2 w-2 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />СЂР°Р±РѕС‚Р°РµС‚</>
              : <><span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-success)' }} />РіРѕС‚РѕРІ</>}
          </span>
          <div className="flex-1" />
          <BuildPicker />
        </header>

        <div ref={scrollRef} onScroll={() => {
            const el = scrollRef.current;
            if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          }} className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
          {messages.length === 0 ? (
            <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-5 py-8">
              <div className="flex flex-col gap-2">
                <h1 className="text-xl font-black" style={{ color: 'var(--color-text)' }}>РЎ С‡РµРј РїРѕРјРѕС‡СЊ?</h1>
                <p className="max-w-xl text-[13px] leading-6" style={{ color: 'var(--color-text-secondary)' }}>
                  РђРіРµРЅС‚ СЂР°Р±РѕС‚Р°РµС‚ СЃ С„Р°Р№Р»Р°РјРё Рё СЃР±РѕСЂРєР°РјРё Р»Р°СѓРЅС‡РµСЂР°, РёС‰РµС‚ РєРѕРЅС‚РµРЅС‚ РЅР° Modrinth Рё СЃС‚Р°РІРёС‚ РµРіРѕ РїСЂСЏРјРѕ РІ СЃР±РѕСЂРєСѓ.
                  Р’С‹Р±РµСЂРё РЅР°РїСЂР°РІР»РµРЅРёРµ вЂ” РїРѕРґСЃС‚Р°РІРёС‚СЃСЏ РіРѕС‚РѕРІР°СЏ РєРѕРјР°РЅРґР°.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {START_TOPICS.map(topic => (
                  <button
                    key={topic.title}
                    onClick={() => { setInput(topic.prompt); composerRef.current?.focus(); }}
                    className="group flex items-start gap-3 rounded-lg p-3 text-left transition-colors hover:bg-[var(--color-surface-2)]"
                    style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded" style={{ background: 'var(--color-surface-2)', color: topic.color }}>
                      {topic.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-bold" style={{ color: 'var(--color-text)' }}>{topic.title}</span>
                      <span className="mt-0.5 block text-[11px] leading-4" style={{ color: 'var(--color-text-tertiary)' }}>{topic.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] leading-5" style={{ color: 'var(--color-text-tertiary)' }}>
                Р РµР¶РёРј <b style={{ color: 'var(--color-text-secondary)' }}>Build</b> РІС‹РїРѕР»РЅСЏРµС‚ Р·Р°РґР°С‡Рё, <b style={{ color: 'var(--color-text-secondary)' }}>Plan</b> С‚РѕР»СЊРєРѕ РїР»Р°РЅРёСЂСѓРµС‚.
                РљРѕРјР°РЅРґС‹ вЂ” <code className="font-mono" style={{ color: 'var(--color-primary)' }}>/help</code>
              </p>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              {messages.map(m => (
                <ChatBubble key={m.id} m={m} streaming={running && m.id === lastAssistantId}
                  onContinue={m.id === lastAssistantId && !running
                    ? () => void send('РџСЂРѕРґРѕР»Р¶Рё СЂРѕРІРЅРѕ СЃ С‚РѕРіРѕ РјРµСЃС‚Р°, РіРґРµ С‚С‹ РѕСЃС‚Р°РЅРѕРІРёР»СЃСЏ. РќРµ РїРѕРІС‚РѕСЂСЏР№ СѓР¶Рµ РЅР°РїРёСЃР°РЅРЅРѕРµ Рё РЅРµ РЅР°С‡РёРЅР°Р№ Р·Р°РЅРѕРІРѕ вЂ” РїСЂРѕСЃС‚Рѕ РїСЂРѕРґРѕР»Р¶Рё.')
                    : undefined}
                  onInstalled={text => void send(text)} />
              ))}
              {running && (
                <div className="flex items-center gap-2 px-1 py-1 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
                  OpenPortal РґСѓРјР°РµС‚вЂ¦
                </div>
              )}
            </div>
          )}
        </div>

        <div className="ore-plain relative shrink-0 border-t p-3" style={{ borderColor: 'var(--color-border)' }}>
          {cmdOpen && cmdList.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 z-30 mx-auto mb-2 w-full max-w-3xl overflow-hidden rounded-lg border p-1"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>
              {cmdList.map(c => (
                <button key={c.cmd} onClick={() => {
                  if (c.instant) { setInput(''); if (!runCommandLine(c.cmd)) void send(c.cmd); }
                  else setInput(`${c.cmd} `);
                }}
                  className="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-2)]">
                  <span className="shrink-0 font-mono text-[11px] font-bold" style={{ color: 'var(--color-primary)' }}>{c.cmd}</span>
                  <span className="truncate text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{c.desc}</span>
                  {!c.instant && <span className="ml-auto shrink-0 text-[9px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>+ РѕРїРёСЃР°РЅРёРµ</span>}
                </button>
              ))}
            </div>
          )}
          {/* РљРѕРјРїРѕР·РµСЂ СЃРѕР±СЂР°РЅ РІ РѕРґРёРЅ РєРѕРЅС‚РµР№РЅРµСЂ: С‚СѓР»Р±Р°СЂ, РїРѕР»Рµ РІРІРѕРґР° Рё РєРЅРѕРїРєРё
              Р±РѕР»СЊС€Рµ РЅРµ РІРёСЃСЏС‚ С‚СЂРµРјСЏ РѕС‚РґРµР»СЊРЅС‹РјРё РїР»Р°РІР°СЋС‰РёРјРё СЂСЏРґР°РјРё. */}
          {/* Р‘РµР· overflow-hidden: РєРѕРЅС‚РµР№РЅРµСЂ РѕР±СЂРµР·Р°Р» РІС‹РїР°РґР°СЋС‰РёР№ СЃРїРёСЃРѕРє РјРѕРґРµР»Рё Рё
              РїР°РЅРµР»СЊ СѓРїСЂР°РІР»РµРЅРёСЏ РјРѕРґРµР»СЏРјРё, РёР·-Р·Р° С‡РµРіРѕ РѕРЅРё РЅРµ РѕС‚РєСЂС‹РІР°Р»РёСЃСЊ. */}
          <div className="mx-auto w-full max-w-3xl rounded-lg"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b p-2" style={{ borderColor: 'var(--color-border)' }}>
                {attachments.map((a, i) => (
                  <AttachmentChip key={i} a={a} onRemove={() => setAttachments(prev => prev.filter((_, j) => j !== i))} />
                ))}
              </div>
            )}
            {/* overflow-x-auto Р·РґРµСЃСЊ РѕР±СЂРµР·Р°Р» Р±С‹ РІС‹РїР°РґР°СЋС‰РёР№ СЃРїРёСЃРѕРє РјРѕРґРµР»Рё,
                РїРѕСЌС‚РѕРјСѓ СЃС‚СЂРѕРєР° С‚СѓР»Р±Р°СЂР° РЅРµ РёРјРµРµС‚ overflow вЂ” РјРѕРґРµР»Рё РјРѕРіСѓС‚
                РІС‹Р»РµР·Р°С‚СЊ РІРІРµСЂС… РїРѕРІРµСЂС… РїРѕР»СЏ РІРІРѕРґР°. */}
            <div className="flex items-center gap-1.5 border-b px-2 py-1.5" style={{ borderColor: 'var(--color-border)' }}>
              <ModeToggle mode={cfg.mode} onChange={m => useOpenCoreStore.getState().setMode(m)} />
              <CurrentModelPicker />
              <ContextMeter onCompact={() => void compressChat()} />
              <EffortPicker value={cfg.effort ?? 'medium'} onChange={v => useOpenCoreStore.getState().updateConfig({ effort: v })} />
              <PresetToggle preset={cfg.permissionPreset ?? 'dfa'} onChange={p => useOpenCoreStore.getState().setPermissionPreset(p)} />
            </div>
            <div className="flex items-end gap-1.5 p-1.5">
              <input type="file" id="op-file" className="hidden" onChange={onFilePicked} />
              <label htmlFor="op-file" title="РџСЂРёРєСЂРµРїРёС‚СЊ С„Р°Р№Р» РёР»Рё РєР°СЂС‚РёРЅРєСѓ"
                className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded transition-colors hover:bg-[var(--color-surface)]"
                style={{ border: '1px dashed var(--color-border)', color: 'var(--color-text-tertiary)' }}>
                <Plus size={14} />
              </label>
              <textarea
                ref={composerRef}
                value={input}
                onChange={e => { setInput(e.target.value); }}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder={running ? 'РђРіРµРЅС‚ Р·Р°РЅСЏС‚ вЂ” РѕС‚РїСЂР°РІСЊ СЃРѕРѕР±С‰РµРЅРёРµ, РѕРЅ РїСЂРѕРґРѕР»Р¶РёС‚ РїРѕСЃР»Рµ С‚РµРєСѓС‰РµРіРѕ С€Р°РіР°' : 'Р§С‚Рѕ СЃРґРµР»Р°С‚СЊ?  (/ вЂ” РєРѕРјР°РЅРґС‹)'}
                className="max-h-40 min-h-9 flex-1 resize-none overflow-y-auto bg-transparent px-2.5 py-1.5 text-[13px] leading-6 outline-none"
                style={{ color: 'var(--color-text)' }}
              />
              {running ? (
                <button onClick={() => { if (currentSessionId) abortRefs.current[currentSessionId]?.abort(); }} title="РћСЃС‚Р°РЅРѕРІРёС‚СЊ"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded"
                  style={{ background: 'var(--color-surface)', color: 'var(--color-error)', border: '1px solid var(--color-border)' }}>
                  <StopCircle size={15} />
                </button>
              ) : (
                <button onClick={() => void send()} title="РћС‚РїСЂР°РІРёС‚СЊ" disabled={!input.trim()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded transition-opacity disabled:opacity-40"
                  style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
                  <Send size={14} />
                </button>
              )}
            </div>
          </div>
          <p className="mt-1.5 text-center text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            РђРіРµРЅС‚ РјРѕР¶РµС‚ РѕС€РёР±Р°С‚СЊСЃСЏ вЂ” РїСЂРѕРІРµСЂСЏР№ РІР°Р¶РЅС‹Рµ РёР·РјРµРЅРµРЅРёСЏ. Р¤Р°Р№Р»С‹ Рё РєР»СЋС‡Рё С…СЂР°РЅСЏС‚СЃСЏ Р»РѕРєР°Р»СЊРЅРѕ РІ РїР°РїРєРµ OpenPortal.
          </p>
        </div>
      </main>

      <ModelManager />
      <PermissionModal />
    </div>
  );
}