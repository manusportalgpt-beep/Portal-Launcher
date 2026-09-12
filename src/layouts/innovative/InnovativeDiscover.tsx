import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Search, Package, Layers, ImageIcon, Sparkles, Database, Compass,
  TrendingUp, ArrowUpRight, RefreshCw, ExternalLink,
} from 'lucide-react';
import { searchModrinthGateway } from '@/lib/modrinth-gateway';

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.38, ease: [0.16, 1, 0.3, 1] } } };

const CATEGORIES = [
  { id: 'mods', icon: Package, label: 'Моды', color: 'var(--color-primary)', desc: 'Изменения геймплея и новый контент' },
  { id: 'modpacks', icon: Layers, label: 'Модпаки', color: '#8B5CF6', desc: 'Готовые наборы модов' },
  { id: 'resourcepacks', icon: ImageIcon, label: 'Ресурспаки', color: '#F59E0B', desc: 'Текстуры и ресурсы' },
  { id: 'shaders', icon: Sparkles, label: 'Шейдеры', color: '#06B6D4', desc: 'Красивая графика' },
  { id: 'datapacks', icon: Database, label: 'Датапаки', color: '#10B981', desc: 'Механики и генерация' },
];

interface TrendingHit {
  title: string;
  slug: string;
  downloads: number;
  icon_url?: string;
  color?: number;
}

export function InnovativeDiscover() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [trending, setTrending] = useState<TrendingHit[]>([]);

  useEffect(() => {
    let alive = true;
    searchModrinthGateway({ query: '', projectType: 'mod', limit: 6, offset: 0, sort: 'downloads' })
      .then(r => { if (alive) setTrending(r.hits || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const doSearch = useCallback((q?: string) => {
    const term = q ?? query;
    navigate(`/discover?query=${encodeURIComponent(term)}`);
  }, [query, navigate]);

  const openType = (projectType: string) => navigate(`/discover?projectType=${projectType}`);

  return (
    <motion.div className="h-full overflow-auto" variants={stagger} initial="hidden" animate="show">
      <div className="mx-6 mt-6">

        {/* hero */}
        <motion.div variants={fadeUp} className="relative overflow-hidden rounded-[26px] p-8 mb-6"
          style={{
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-info) 18%, transparent) 0%, color-mix(in srgb, var(--color-surface) 72%, transparent) 50%, color-mix(in srgb, var(--color-modrinth) 12%, transparent) 100%)',
            border: '1px solid color-mix(in srgb, var(--color-border-strong) 45%, var(--color-info))',
            boxShadow: '0 20px 50px -18px color-mix(in srgb, var(--color-info) 32%, transparent)',
          }}>
          <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full opacity-22 animate-aurora"
            style={{ background: 'var(--color-modrinth)', filter: 'blur(60px)' }} />
          <div className="absolute -bottom-24 -left-16 h-52 w-52 rounded-full opacity-16 animate-aurora"
            style={{ background: 'var(--color-info)', filter: 'blur(60px)', animationDelay: '-3s' }} />

          <div className="relative z-10">
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold"
              style={{ background: 'color-mix(in srgb, var(--color-info) 18%, transparent)', color: 'var(--color-info)', border: '1px solid color-mix(in srgb, var(--color-info) 35%, transparent)' }}>
              <Compass size={12} />
              Обзор
            </span>
            <h1 className="mt-4 text-[28px] font-extrabold tracking-tight" style={{ color: 'var(--color-text)' }}>
              Найдите свой контент
            </h1>
            <p className="mt-2 text-[13px] max-w-lg" style={{ color: 'var(--color-text-secondary)' }}>
              Моды, модпаки, ресурспаки и шейдеры с Modrinth и CurseForge
            </p>

            <div className="mt-6 flex items-center gap-3">
              <div className="flex-1 flex items-center gap-3 rounded-2xl px-5 py-3"
                style={{ background: 'color-mix(in srgb, var(--color-surface) 72%, transparent)', border: '1px solid var(--color-border)' }}>
                <Search size={17} style={{ color: 'var(--color-text-tertiary)' }} />
                <input value={query} onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doSearch()}
                  placeholder="Найти моды, паки, шейдеры…"
                  className="flex-1 bg-transparent text-[14px] font-semibold outline-none" style={{ color: 'var(--color-text)' }} />
              </div>
              <button onClick={() => doSearch()}
                className="flex items-center gap-2 rounded-2xl px-6 py-3 text-[13px] font-bold transition-all hover:scale-[1.03] active:scale-[0.97]"
                style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', boxShadow: '0 10px 28px -10px color-mix(in srgb, var(--color-primary) 70%, transparent)' }}>
                <Search size={15} /> Найти
              </button>
            </div>
          </div>
        </motion.div>

        {/* categories */}
        <motion.div variants={fadeUp}>
          <p className="mb-3 text-[13px] font-extrabold" style={{ color: 'var(--color-text)' }}>Категории</p>
          <div className="grid grid-cols-5 gap-3">
            {CATEGORIES.map(cat => (
              <button key={cat.id} onClick={() => openType(cat.id)}
                className="group flex flex-col items-center gap-3 rounded-[20px] p-5 text-center transition-all hover:scale-[1.04] active:scale-[0.97]"
                style={{ background: 'color-mix(in srgb, var(--color-surface) 72%, transparent)', border: '1px solid var(--color-border)' }}>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl transition-transform group-hover:scale-110"
                  style={{ background: `color-mix(in srgb, ${cat.color} 16%, transparent)`, color: cat.color }}>
                  <cat.icon size={20} />
                </div>
                <div>
                  <p className="text-[13px] font-bold" style={{ color: 'var(--color-text)' }}>{cat.label}</p>
                  <p className="mt-0.5 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{cat.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </motion.div>

        {/* trending */}
        {trending.length > 0 && (
          <motion.div variants={fadeUp} className="mt-8">
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp size={15} style={{ color: 'var(--color-primary)' }} />
              <p className="text-[13px] font-extrabold" style={{ color: 'var(--color-text)' }}>Популярные моды</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {trending.map(hit => (
                <button key={hit.slug || hit.title}
                  onClick={() => navigate(`/discover/modrinth/${hit.slug || hit.title}`)}
                  className="group flex items-center gap-3 rounded-2xl p-4 text-left transition-all hover:scale-[1.01] active:scale-[0.99]"
                  style={{ background: 'color-mix(in srgb, var(--color-surface) 72%, transparent)', border: '1px solid var(--color-border)' }}>
                  {hit.icon_url
                    ? <img src={hit.icon_url} className="h-11 w-11 shrink-0 rounded-2xl object-cover" alt="" />
                    : <div className="h-11 w-11 shrink-0 rounded-2xl flex items-center justify-center text-[10px] font-bold"
                        style={{ background: hit.color ? `#${hit.color.toString(16).padStart(6, '0')}` : 'var(--color-surface-2)', color: '#fff' }}>
                        {hit.title[0]}
                      </div>
                  }
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold" style={{ color: 'var(--color-text)' }}>{hit.title}</p>
                    <p className="mt-0.5 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                      {hit.downloads.toLocaleString()} загрузок
                    </p>
                  </div>
                  <ArrowUpRight size={14} className="opacity-0 transition-opacity group-hover:opacity-100 shrink-0" style={{ color: 'var(--color-primary)' }} />
                </button>
              ))}
            </div>
          </motion.div>
        )}

      </div>
    </motion.div>
  );
}
