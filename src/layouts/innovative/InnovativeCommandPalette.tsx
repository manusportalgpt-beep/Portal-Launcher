import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  House, Compass, Boxes, Palette, Settings, Sparkles, Plus, Upload,
  Play, Search, CornerDownLeft, Square, ArrowUp, ArrowDown,
} from 'lucide-react';
import { useInstanceStore, type Instance } from '@/stores/instanceStore';
import { useCurrentUser } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useLaunchStore } from '@/stores/launchStore';
import { invoke } from '@/lib/invoke-shim';
import { toIconSrc } from '@/lib/icon-src';

interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  icon: any;
  group: string;
  run: () => void;
  search: string;
}

export function InnovativeCommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const instances = useInstanceStore(s => s.instances);
  const user = useCurrentUser();
  const globalSettings = useSettingsStore(s => ({
    minRam: s.minRam, maxRam: s.maxRam, javaPath: s.javaPath, customJvmArgs: s.customJvmArgs,
  }));
  const getStatus = useLaunchStore(s => s.getStatus);
  const setStatus = useLaunchStore(s => s.setStatus);
  const update = useInstanceStore(s => s.update);

  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setQuery(''); setIndex(0); setTimeout(() => inputRef.current?.focus(), 60); }
  }, [open]);

  const go = (to: string) => { onClose(); navigate(to); };

  const launch = async (inst: Instance) => {
    onClose();
    if (user && getStatus(inst.id) === 'idle') {
      setStatus(inst.id, 'launching');
      try {
        await invoke('ensure_instance', {
          id: inst.id, name: inst.name, mcVersion: inst.minecraftVersion,
          loader: inst.modLoader, loaderVersion: inst.modLoaderVersion || '',
          minRam: globalSettings.minRam, maxRam: globalSettings.maxRam,
          javaPath: globalSettings.javaPath || '', customJvmArgs: globalSettings.customJvmArgs || '',
          color: inst.color, icon: inst.iconPath || null,
        });
        update(inst.id, { lastPlayed: new Date().toISOString() });
        if (user.uuid && user.username) {
          await invoke('launch_instance', {
            instance_id: inst.id, access_token: user.accessToken || '',
            uuid: user.uuid, username: user.username, provider: user.provider,
          });
        }
      } catch (e) { console.error(e); setStatus(inst.id, 'idle'); }
    } else {
      go(`/library/${inst.id}`);
    }
  };

  const commands = useMemo<PaletteCommand[]>(() => {
    const nav: PaletteCommand[] = [
      { id:'home', label:'Главная', icon: House, group:'Навигация', search:'home главная дом', run: () => go('/home') },
      { id:'discover', label:'Обзор', hint:'Моды, паки, шейдеры', icon: Compass, group:'Навигация', search:'discover обзор моды', run: () => go('/discover') },
      { id:'library', label:'Библиотека', icon: Boxes, group:'Навигация', search:'library библиотека сборки', run: () => go('/library') },
      { id:'skins', label:'Скины', icon: Palette, group:'Навигация', search:'skins скины образ', run: () => go('/skins') },
      { id:'settings', label:'Настройки', icon: Settings, group:'Навигация', search:'settings настройки', run: () => go('/settings') },
    ];
    const actions: PaletteCommand[] = [
      { id:'create', label:'Создать сборку', hint:'Вручную', icon: Plus, group:'Действия', search:'create сборка создать', run: () => go('/library?create=1') },
      { id:'import', label:'Импортировать сборку', hint:'.mrpack / .zip', icon: Upload, group:'Действия', search:'import импорт mrpack zip', run: () => go('/library?import=1') },
      { id:'extended', label:'Расширенный интерфейс', hint:'Иконки и кнопки', icon: Sparkles, group:'Действия', search:'extended расширенный интерфейс', run: () => go('/settings/extended') },
    ];
    const builds: PaletteCommand[] = instances.slice(0, 6).map(inst => ({
      id: `inst-${inst.id}`,
      label: inst.name,
      hint: `${inst.minecraftVersion} · ${inst.modLoader}`,
      icon: Play,
      group: 'Сборки',
      search: `build ${inst.name} ${inst.minecraftVersion} ${inst.modLoader}`,
      run: () => launch(inst),
    }));
    return [...nav, ...actions, ...builds];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances, user, open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(c => `${c.label} ${c.search}`.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => { setIndex(0); }, [query, open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter' && filtered[index]) { filtered[index].run(); }
  };

  const groups = useMemo(() => {
    const order = ['Навигация', 'Действия', 'Сборки'];
    const map = new Map<string, PaletteCommand[]>();
    for (const c of filtered) {
      const list = map.get(c.group) ?? [];
      list.push(c);
      map.set(c.group, list);
    }
    return order.filter(g => map.has(g)).map(g => ({ group: g, items: map.get(g)! }));
  }, [filtered]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="palette"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-[400] flex items-start justify-center pt-[12vh]"
          style={{ background: 'rgba(4,6,12,0.55)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}
          onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ y: -16, scale: 0.97, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -10, scale: 0.98, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="w-[560px] max-w-[calc(100vw-48px)] overflow-hidden rounded-[24px]"
            style={{
              background: 'color-mix(in srgb, var(--color-surface) 68%, var(--color-bg))',
              border: '1px solid color-mix(in srgb, var(--color-border-strong) 42%, var(--color-primary))',
              boxShadow: '0 32px 80px -20px rgba(0,0,0,0.6), 0 0 0 1px color-mix(in srgb, var(--color-primary) 8%, transparent), 0 0 52px -14px color-mix(in srgb, var(--color-primary) 45%, transparent)',
              backdropFilter: 'blur(38px) saturate(1.6)',
              WebkitBackdropFilter: 'blur(38px) saturate(1.6)',
            }}
            onKeyDown={onKeyDown}
          >
            {/* search */}
            <div className="flex items-center gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--color-border)' }}>
              <Search size={17} style={{ color: 'var(--color-primary)' }} />
              <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Что вы хотите сделать?"
                className="flex-1 bg-transparent text-[15px] font-semibold outline-none"
                style={{ color: 'var(--color-text)' }} />
              <kbd className="rounded-lg px-2 py-1 text-[10px] font-bold"
                style={{ background: 'color-mix(in srgb, var(--color-surface-2) 70%, transparent)', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}>
                ESC
              </kbd>
            </div>

            {/* commands */}
            <div className="max-h-[46vh] overflow-y-auto p-2">
              {filtered.length === 0 && (
                <p className="px-4 py-8 text-center text-[13px]" style={{ color: 'var(--color-text-tertiary)' }}>
                  Ничего не найдено
                </p>
              )}
              {groups.map(g => (
                <div key={g.group} className="mb-1">
                  <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-tertiary)' }}>
                    {g.group}
                  </p>
                  {g.items.map((cmd, i) => {
                    const actual = filtered.indexOf(cmd);
                    const selected = actual === index;
                    const Icon = cmd.icon;
                    return (
                      <button key={cmd.id}
                        onMouseEnter={() => setIndex(actual)}
                        onClick={() => cmd.run()}
                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors"
                        style={{
                          background: selected ? 'color-mix(in srgb, var(--color-primary) 15%, transparent)' : 'transparent',
                        }}>
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                          style={{
                            background: selected ? 'color-mix(in srgb, var(--color-primary) 20%, transparent)' : 'color-mix(in srgb, var(--color-surface-2) 60%, transparent)',
                            color: selected ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                          }}>
                          <Icon size={15} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold" style={{ color: selected ? 'var(--color-primary)' : 'var(--color-text)' }}>
                            {cmd.label}
                          </span>
                          {cmd.hint && (
                            <span className="block truncate text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{cmd.hint}</span>
                          )}
                        </span>
                        {selected && <CornerDownLeft size={13} style={{ color: 'var(--color-primary)' }} />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* footer */}
            <div className="flex items-center gap-4 border-t px-5 py-3" style={{ borderColor: 'var(--color-border)' }}>
              <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                <ArrowUp size={11} /> <ArrowDown size={11} /> навигация
              </span>
              <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                <CornerDownLeft size={11} /> выбрать
              </span>
              <span className="flex-1" />
              <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                <Play size={11} /> Запуск сборок
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
