import { useState, useRef, useEffect, useMemo, type DragEvent } from 'react';
import { invoke } from '@/lib/invoke-shim';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, User, AlertCircle, RotateCcw, Shirt, Sparkles,
  X, Loader2, ImageIcon, Layers, Trash2, Pencil, Search,
} from 'lucide-react';
import { useAuthStore, useCurrentUser } from '@/stores/authStore';
import { SkinStand3D, type SkinModel } from '@/components/skin/SkinStand3D';
import { useUiStore } from '@/stores/uiStore';

interface CapeInfo { id: string; url: string; alias: string; active: boolean }
interface ProfileTextures {
  uuid: string; name: string; skin_url: string; skin_bytes?: number[] | null; skin_variant: string; capes: CapeInfo[];
}
interface PublicSkinTexture {
  uuid: string; name: string; skin_url: string; skin_variant: string; skin_bytes: number[];
}

const STEVE_UUID = '8667ba71-b85a-4004-af54-457a9734eed7';
const SKIN_HISTORY_KEY = 'portal-player-skin-history-v1';
const SKIN_SELECTED_KEY = 'portal-player-selected-skin-v1';
const MAX_AUTO_SKINS = 6;

interface SavedSkin { id: string; name: string; dataUrl: string; model: SkinModel; savedAt: number; textureHash?: string; capeId?: string | null; capeUrl?: string | null }
function loadSkinHistory(): SavedSkin[] {
  try {
    const value = JSON.parse(localStorage.getItem(SKIN_HISTORY_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    const unique: SavedSkin[] = [];
    for (const [index, item] of value.entries()) {
      if (typeof item?.id !== 'string' || typeof item?.dataUrl !== 'string' || (item?.model !== 'classic' && item?.model !== 'slim')) continue;
      if (unique.some(existing => existing.dataUrl === item.dataUrl || (item.textureHash && existing.textureHash === item.textureHash))) continue;
      unique.push({ ...item, name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `Skin ${index + 1}` } as SavedSkin);
      if (unique.length >= MAX_AUTO_SKINS) break;
    }
    return unique;
  } catch { return []; }
}
function persistSkinHistory(items: SavedSkin[]) { try { localStorage.setItem(SKIN_HISTORY_KEY, JSON.stringify(items)); } catch {} }
function loadSelectedSkinId() { try { return localStorage.getItem(SKIN_SELECTED_KEY) || null; } catch { return null; } }
function persistSelectedSkinId(id: string | null) { try { if (id) localStorage.setItem(SKIN_SELECTED_KEY, id); else localStorage.removeItem(SKIN_SELECTED_KEY); } catch {} }
function addSkinToHistory(items: SavedSkin[], skin: SavedSkin) {
  const duplicate = items.find(item => (skin.textureHash && item.textureHash === skin.textureHash) || item.dataUrl === skin.dataUrl);
  const automaticCapture = skin.name.endsWith(' — active');
  const reused = duplicate ? { ...duplicate, name: automaticCapture ? duplicate.name : (skin.name || duplicate.name), model: skin.model, capeId: skin.capeId, capeUrl: skin.capeUrl, savedAt: skin.savedAt, textureHash: skin.textureHash ?? duplicate.textureHash } : skin;
  return [reused, ...items.filter(item => item.id !== duplicate?.id && item.dataUrl !== skin.dataUrl && (!skin.textureHash || item.textureHash !== skin.textureHash))].slice(0, MAX_AUTO_SKINS);
}
async function hashTexture(bytes: number[]): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return btoa(String.fromCharCode(...bytes));
}
function makeSkinId() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`; }

/** Minecraft accepts the modern 64×64 sheet and the legacy 64×32 sheet only. */
function validateMinecraftSkinPng(bytes: number[]): string | null {
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || !png.every((value, index) => bytes[index] === value)) return 'Выберите настоящий PNG-файл скина Minecraft.';
  const view = new DataView(new Uint8Array(bytes).buffer);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width !== 64 || (height !== 64 && height !== 32)) return 'Подходит только текстура скина Minecraft: PNG 64×64 (или legacy 64×32).';
  return null;
}

const card = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-card)',
};

/** Панель выбора: тип тела с живым превью на 3D-стенде. */
function ModelToggle({ value, onChange }: { value: SkinModel; onChange: (m: SkinModel) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {([
        { id: 'classic' as SkinModel, title: 'Classic', hint: 'Широкие руки · 4 px' },
        { id: 'slim' as SkinModel, title: 'Slim', hint: 'Тонкие руки · 3 px' },
      ]).map(opt => {
        const active = value === opt.id;
        return (
          <button key={opt.id} onClick={() => onChange(opt.id)}
            className="flex flex-col items-start gap-0.5 px-3 py-2.5 text-left"
            style={{
              borderRadius: 'var(--radius-button)',
              background: active ? 'var(--color-primary)' : 'var(--color-surface-2)',
              border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
              color: active ? 'var(--color-primary-text)' : 'var(--color-text)',
            }}>
            <span className="text-xs font-bold">{opt.title}</span>
            <span className="text-[10px] opacity-70">{opt.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Пред-просмотр перед применением: текстура + тип тела + плащ. */
function SkinPreviewModal({
  dataUrl, model, name, capes, capeId, busy, error,
  onName, onModel, onCape, onPickAnother, onApply, onClose,
}: {
  dataUrl: string; model: SkinModel; name: string; capes: CapeInfo[]; capeId?: string | null; busy: boolean; error: string;
  onName: (name: string) => void; onModel: (m: SkinModel) => void; onCape: (capeId: string | null) => void; onPickAnother: () => void; onApply: () => void; onClose: () => void;
}) {
  const selectedCape = capes.find(cape => cape.id === capeId) ?? null;
  return (
    <motion.div className="fixed inset-0 z-[80] flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <motion.div className="w-full max-w-3xl overflow-hidden"
        style={{ ...card, background: 'var(--color-surface)', boxShadow: 'var(--shadow-lg)', borderRadius: 'var(--radius-modal)' }}
        initial={{ scale: 0.94, y: 14, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.94, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 460, damping: 34 }}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="w-4 h-4 shrink-0" style={{ color: 'var(--color-primary)' }} />
            <h2 className="font-bold text-sm truncate" style={{ color: 'var(--color-text)' }}>Редактор пресета скина</h2>
          </div>
          <button onClick={onClose} disabled={busy}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/5">
            <X className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
          </button>
        </div>

        <div className="grid gap-5 p-5" style={{ gridTemplateColumns: 'minmax(0,1fr) 280px' }}>
          <div className="rounded-2xl overflow-hidden"
            style={{ background: 'radial-gradient(ellipse at 50% 15%, color-mix(in srgb, var(--color-primary) 16%, var(--color-surface-2)) 0%, var(--color-bg) 75%)', border: '1px solid var(--color-border)' }}>
            <SkinStand3D skinUrl={dataUrl} capeUrl={selectedCape?.url ?? null} model={model} height={360} cameraDistance={68} autoRotate={false} />
          </div>

          <div className="flex flex-col gap-4 min-w-0">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Название пресета</p>
              <input value={name} maxLength={36} onChange={event => onName(event.target.value)} placeholder="Например, Survival"
                className="w-full px-3 py-2.5 text-sm outline-none" style={{ borderRadius: 'var(--radius-button)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Тип тела</p>
              <ModelToggle value={model} onChange={onModel} />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Плащ для этого пресета</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => onCape(null)} className="px-2.5 py-2 text-left text-[11px] font-semibold" style={{ borderRadius: 'var(--radius-button)', background: !selectedCape ? 'var(--color-primary-dim)' : 'var(--color-surface-2)', border: `1px solid ${!selectedCape ? 'var(--color-primary)' : 'var(--color-border)'}`, color: 'var(--color-text)' }}>
                  Без плаща
                </button>
                {capes.map(cape => <button key={cape.id} onClick={() => onCape(cape.id)} className="flex items-center gap-2 px-2.5 py-2 text-left text-[11px] font-semibold" style={{ borderRadius: 'var(--radius-button)', background: selectedCape?.id === cape.id ? 'var(--color-primary-dim)' : 'var(--color-surface-2)', border: `1px solid ${selectedCape?.id === cape.id ? 'var(--color-primary)' : 'var(--color-border)'}`, color: 'var(--color-text)' }}><span className="h-4 w-4 shrink-0 rounded-sm" style={{ background: `center / cover url(${cape.url})` }} /> <span className="truncate">{cape.alias}</span></button>)}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Текстура</p>
              <div className="flex items-center gap-3 p-2.5" style={{ ...card, background: 'var(--color-surface-2)' }}>
                <img src={dataUrl} alt="skin sheet" className="w-14 h-14 object-contain"
                  style={{ imageRendering: 'pixelated', background: 'var(--color-surface)', borderRadius: 8 }} />
                <button onClick={onPickAnother} className="text-xs font-semibold" style={{ color: 'var(--color-primary)' }}>
                  Сменить текстуру
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-2.5 text-xs"
                style={{ borderRadius: 'var(--radius-button)', background: 'rgba(231,76,60,0.12)', color: 'var(--color-error)' }}>
                <AlertCircle className="w-4 h-4 shrink-0 mt-px" />{error}
              </div>
            )}

            <div className="mt-auto flex flex-col gap-2">
              <button onClick={onApply} disabled={busy}
                className="flex items-center justify-center gap-2 py-2.5 text-sm font-bold"
                style={{ borderRadius: 'var(--radius-button)', background: 'var(--color-primary)', color: 'var(--color-primary-text)', opacity: busy ? 0.6 : 1 }}>
                {busy ? <><Loader2 className="w-4 h-4 animate-spin" />Применяем…</> : <><Check className="w-4 h-4" />Сохранить и применить</>}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function SkinSelectorPage() {
  const user = useCurrentUser();
  const updateAccount = useAuthStore(state => state.updateAccount);
  const ui = useUiStore();
  const token = user?.accessToken;
  const isMicrosoft = user?.provider === 'microsoft' || (!!user && !user.provider && !user.isDemo);
  const isElyby = user?.provider === 'elyby';
  // Загрузка скина работает только для настоящих Microsoft-аккаунтов — у
  // Ely.by нет задокументированного авторизованного эндпоинта для записи,
  // а офлайн-аккаунт вообще ни к какому серверу не привязан.
  const canEdit = isMicrosoft && !!token;
  const canView = (isMicrosoft && !!token) || (isElyby && !!user?.username);

  // The UI store can keep a token longer than the Rust account cache. Ask the
  // backend for a refreshed Minecraft token before any write operation.
  const getFreshMicrosoftToken = async (): Promise<string> => {
    if (!isMicrosoft || !token || !user) return token ?? '';
    try {
      const account = await invoke<any>('msa_get_account');
      const fresh = String(account?.access_token ?? '').trim();
      if (fresh) {
        updateAccount(user.uuid, {
          accessToken: fresh,
          refreshToken: account.refresh_token || user.refreshToken,
          tokenExpiry: account.expires_at ? Number(account.expires_at) * 1000 : user.tokenExpiry,
          skinUrl: account.skin_url || user.skinUrl,
        });
        return fresh;
      }
    } catch {
      // The upload command returns the original API error if refresh is not
      // possible, so a network failure is never silently treated as success.
    }
    return token;
  };

  const [model, setModel] = useState<SkinModel>('classic');
  const [profile, setProfile] = useState<ProfileTextures | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Пред-просмотр загруженной текстуры
  const [pending, setPending] = useState<{ dataUrl: string; bytes: number[]; textureHash: string } | null>(null);
  const [pendingModel, setPendingModel] = useState<SkinModel>('classic');
  const [pendingName, setPendingName] = useState('');
  const [pendingCapeId, setPendingCapeId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [skinHistory, setSkinHistory] = useState<SavedSkin[]>(loadSkinHistory);
  const [nickname, setNickname] = useState('');
  const [nicknameLoading, setNicknameLoading] = useState(false);
  const [selectedSkinId, setSelectedSkinId] = useState<string | null>(loadSelectedSkinId);
  const [applySequence, setApplySequence] = useState(0);
  const [activeTextureHash, setActiveTextureHash] = useState<string | null>(null);

  useEffect(() => { persistSelectedSkinId(selectedSkinId); }, [selectedSkinId]);
  useEffect(() => {
    if (selectedSkinId && !skinHistory.some(skin => skin.id === selectedSkinId)) setSelectedSkinId(null);
  }, [selectedSkinId, skinHistory]);
  useEffect(() => {
    if (!activeTextureHash) return;
    const matchingPreset = skinHistory.find(skin => skin.textureHash === activeTextureHash);
    if (matchingPreset) setSelectedSkinId(matchingPreset.id);
  }, [activeTextureHash, skinHistory]);

  const fileRef = useRef<HTMLInputElement>(null);

  const uuid = profile?.uuid || user?.uuid || STEVE_UUID;
  const activeCape = profile?.capes.find(c => c.active) ?? null;
  const liveSkinUrl = useMemo(() => {
    if (profile?.skin_bytes?.length) return `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(profile.skin_bytes)))}`;
    if (!profile?.skin_url) return `https://crafatar.com/skins/${uuid}?_=${refreshKey}`;
    const separator = profile.skin_url.includes('?') ? '&' : '?';
    return `${profile.skin_url}${separator}_=${refreshKey}`;
  }, [profile?.skin_url, profile?.skin_bytes, uuid, refreshKey]);

  const rememberAppliedSkin = (skin: SavedSkin) => setSkinHistory(previous => {
    const next = addSkinToHistory(previous, skin);
    persistSkinHistory(next);
    return next;
  });

  const captureActiveSkin = async (): Promise<SavedSkin | null> => {
    if (!profile?.skin_url && !profile?.skin_bytes?.length) return null;
    try {
      const bytes = profile.skin_bytes?.length
        ? Array.from(profile.skin_bytes)
        : Array.from(new Uint8Array(await (await fetch(profile.skin_url, { cache: 'no-store' })).arrayBuffer()));
      const validation = validateMinecraftSkinPng(bytes);
      if (validation) return null;
      const dataUrl = `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(bytes)))}`;
      const active = profile.capes.find(cape => cape.active) ?? null;
      const textureHash = await hashTexture(bytes);
      setActiveTextureHash(textureHash);
      return { id: makeSkinId(), name: profile.name || 'Skin', dataUrl, textureHash, model: profile.skin_variant === 'slim' ? 'slim' : 'classic', capeId: active?.id ?? null, capeUrl: active?.url ?? null, savedAt: Date.now() };
    } catch { return null; }
  };

  const loadProfile = async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const profileToken = isMicrosoft ? await getFreshMicrosoftToken() : '';
      const p = isMicrosoft
        ? await invoke<ProfileTextures>('get_profile_textures', { access_token: profileToken })
        : await invoke<ProfileTextures>('get_elyby_textures', { username: user!.username });
      setProfile(p);
      setModel(p.skin_variant === 'slim' ? 'slim' : 'classic');
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally { setLoading(false); }
  };

  useEffect(() => { loadProfile(); /* eslint-disable-next-line */ }, [user?.uuid, user?.username, token]);
  useEffect(() => {
    let cancelled = false;
    void captureActiveSkin().then(skin => { if (skin && !cancelled) rememberAppliedSkin(skin); });
    return () => { cancelled = true; };
    // The active profile texture is intentionally the source of automatic history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.skin_url, profile?.skin_variant]);

  const flash = (msg: string) => { setOk(msg); setTimeout(() => setOk(''), 3500); };

  const openPreview = async (file: File) => {
    setError('');
    const buffer = await file.arrayBuffer();
    const bytes = Array.from(new Uint8Array(buffer));
    const validation = validateMinecraftSkinPng(bytes);
    if (validation) { setError(validation); return; }
    const textureHash = await hashTexture(bytes);
    const dataUrl = await new Promise<string>(res => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(file);
    });
    setPendingModel(model);
    setPendingName(file.name.replace(/\.png$/i, '').trim() || 'New skin');
    setPendingCapeId(activeCape?.id ?? null);
    setPreviewError('');
    setPending({ dataUrl, bytes, textureHash });
  };

  const importSkinByNickname = async () => {
    const requestedName = nickname.trim();
    if (!requestedName) { setError('Введите ник игрока.'); return; }
    setNicknameLoading(true); setError('');
    try {
      const found = await invoke<PublicSkinTexture>('lookup_public_skin', { username: requestedName });
      const validation = validateMinecraftSkinPng(found.skin_bytes);
      if (validation) throw new Error(validation);
      const blob = new Blob([new Uint8Array(found.skin_bytes)], { type: 'image/png' });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      setPendingModel(found.skin_variant === 'slim' ? 'slim' : 'classic');
      setPendingName(requestedName);
      setPendingCapeId(activeCape?.id ?? null);
      setPreviewError('');
      setSelectedSkinId(null);
      setPending({ dataUrl, bytes: found.skin_bytes, textureHash: await hashTexture(found.skin_bytes) });
    } catch (e: any) {
      setError(String(e?.message ?? 'Не удалось загрузить скин игрока.'));
    } finally {
      setNicknameLoading(false);
    }
  };

  const applyPending = async () => {
    if (!pending || !canEdit) return;
    setApplying(true); setPreviewError('');
    try {
      const requestToken = await getFreshMicrosoftToken();
      const updated = await invoke<ProfileTextures>('upload_skin_bytes', { access_token: requestToken, data: pending.bytes, variant: pendingModel });
      let capes = updated.capes;
      const validCapeId = updated.capes.some(cape => cape.id === pendingCapeId) ? pendingCapeId : null;
      if (validCapeId) {
        capes = await invoke<CapeInfo[]>('set_active_cape', { access_token: requestToken, cape_id: validCapeId });
      } else if (updated.capes.some(cape => cape.active)) {
        await invoke('hide_active_cape', { access_token: requestToken });
        capes = updated.capes.map(cape => ({ ...cape, active: false }));
      }
      setProfile({ ...updated, capes });
      updateAccount(user!.uuid, { accessToken: requestToken, skinUrl: updated.skin_url, faceCacheRevision: Date.now() });
      const selectedCape = capes.find(cape => cape.id === validCapeId) ?? null;
      const appliedSkinId = makeSkinId();
      rememberAppliedSkin({ id: appliedSkinId, name: pendingName.trim() || 'New skin', dataUrl: pending.dataUrl, textureHash: pending.textureHash, model: pendingModel, capeId: selectedCape?.id ?? null, capeUrl: selectedCape?.url ?? null, savedAt: Date.now() });
      setSelectedSkinId(appliedSkinId);
      setModel(pendingModel);
      setApplySequence(sequence => sequence + 1);
      setPending(null);
      setRefreshKey(k => k + 1);
      flash('Скин применён. Перезапустите Minecraft, чтобы он сразу получил новую текстуру.');
      setTimeout(loadProfile, 3500);
    } catch (e: any) {
      setPreviewError(String(e?.message ?? e));
    } finally { setApplying(false); }
  };

  const selectHistorySkin = async (skin: SavedSkin) => {
    if (!canEdit) return;
    try {
      const response = await fetch(skin.dataUrl);
      const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
      const textureHash = skin.textureHash ?? await hashTexture(bytes);
      setSelectedSkinId(skin.id);
      setPendingModel(skin.model);
      setPendingName(skin.name);
      setPendingCapeId(skin.capeId ?? null);
      setPreviewError('');
      setPending({ dataUrl: skin.dataUrl, bytes, textureHash });
    } catch (e: any) { setError(String(e?.message ?? e)); }
  };

  const deleteHistorySkin = (skin: SavedSkin) => {
    const next = skinHistory.filter(item => item.id !== skin.id);
    setSkinHistory(next);
    persistSkinHistory(next);
    flash(`Пресет «${skin.name}» удалён`);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) openPreview(f);
  };

  return (
    <div className="h-full min-h-0 flex flex-col">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 pt-5 pb-4 sm:flex sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold sm:text-2xl" style={{ color: 'var(--color-text)' }}>Skin Studio</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Именованные пресеты с 3D-проверкой, типом тела и плащом внутри редактора
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={loadProfile} disabled={!canView || loading}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold"
            style={{ borderRadius: 'var(--radius-button)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}Обновить
          </button>
        </div>
      </header>

      <input ref={fileRef} type="file" accept=".png,image/png" className="hidden"
        onChange={e => e.target.files?.[0] && openPreview(e.target.files[0])} />

      <div className="flex-1 min-h-0 scroll-area px-6 pb-6">
        <div className="grid gap-5" style={{ gridTemplateColumns: 'minmax(320px, 420px) minmax(0, 1fr)' }}>
          {/* 3D стенд */}
          <div className="flex flex-col gap-4">
            <div className="overflow-hidden" style={{ ...card, borderRadius: 'var(--radius-modal)' }}>
              <div className="relative" style={{ background: 'radial-gradient(ellipse at 50% 15%, color-mix(in srgb, var(--color-primary) 18%, var(--color-surface-2)) 0%, var(--color-bg) 78%)' }}>
                {ui.showSkinStandName && <div className="pointer-events-none absolute inset-x-0 top-5 z-10 flex justify-center"><span className="inline-flex max-w-[78%] items-center truncate px-3 py-1 text-[11px] font-bold tracking-[0.01em]" style={{ borderRadius: 5, color: '#fff', background: 'rgba(8, 10, 16, 0.46)', border: '1px solid rgba(255,255,255,0.18)', boxShadow: '0 2px 0 rgba(0,0,0,0.38), 0 5px 16px rgba(0,0,0,0.24)', backdropFilter: 'blur(4px)', textShadow: '0 1px 2px rgba(0,0,0,0.95)' }}>{profile?.name || user?.username || 'Steve'}</span></div>}
                <SkinStand3D skinUrl={liveSkinUrl} capeUrl={activeCape?.url ?? null} model={model} height={440} cameraDistance={70} autoRotate={false} applySequence={applySequence} trackCursor />
              </div>
              <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: 'var(--color-text)' }}>{profile?.name || user?.username || 'Steve'}</p>
                  <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                    {model === 'slim' ? 'Slim' : 'Classic'}{activeCape ? ` · ${activeCape.alias}` : ' · без плаща'}
                  </p>
                </div>
                <span className="text-[10px] font-semibold px-2 py-1"
                  style={{ borderRadius: 999, background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)' }}>
                  перетаскивайте для обзора
                </span>
              </div>
            </div>

            <div className="p-4" style={card}>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 shrink-0" style={{ color: 'var(--color-primary)' }} />
                <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>Выберите или создайте пресет справа. Тип тела и плащ привязаны к пресету, поэтому случайно не меняют текущий вид.</p>
              </div>
            </div>
          </div>

          {/* Правая колонка */}
          <div className="flex flex-col gap-5 min-w-0">
            {!canEdit && (
              <div className="flex items-center gap-3 p-4" style={card}>
                {user?.isDemo ? <AlertCircle className="w-5 h-5 shrink-0" style={{ color: 'var(--color-warning)' }} />
                  : <User className="w-5 h-5 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />}
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    {user?.isDemo ? 'Оффлайн-аккаунт не привязан ни к какому серверу'
                      : isElyby ? 'Ely.by: текстуры читаются из профиля'
                      : 'Войдите через Microsoft'}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {isElyby
                      ? 'Официальный skins system Ely.by документирует только чтение текстур; безопасной API-загрузки в нём нет. Откройте официальный менеджер Ely.by, затем нажмите «Обновить» здесь.'
                      : 'Стенд работает в режиме просмотра, применение недоступно.'}
                  </p>
                </div>
              </div>
            )}

            {/* Загрузка */}
            <div className="p-5" style={card}>
              <h3 className="font-bold text-sm mb-1" style={{ color: 'var(--color-text)' }}>Своя текстура</h3>
              <p className="text-xs mb-4" style={{ color: 'var(--color-text-secondary)' }}>
                Только реальная текстура Minecraft: PNG 64×64 или legacy 64×32. Перед применением откроется редактор с выбором имени, тела и плаща.
              </p>
              <div onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)} onDrop={onDrop}
                onClick={() => canEdit && fileRef.current?.click()}
                className="flex flex-col items-center justify-center p-7 cursor-pointer"
                style={{
                  borderRadius: 'var(--radius-card)',
                  background: dragOver ? 'var(--color-primary-dim)' : 'var(--color-surface-2)',
                  border: `2px dashed ${dragOver ? 'var(--color-primary)' : 'var(--color-border)'}`,
                }}>
                <ImageIcon className="w-7 h-7 mb-2.5" style={{ color: dragOver ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  {dragOver ? 'Отпустите файл' : 'Перетащите PNG или нажмите'}
                </p>
              </div>
            </div>

            <div className="p-4" style={card}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background:'var(--color-primary-dim)', color:'var(--color-primary)' }}><Search className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold" style={{ color:'var(--color-text)' }}>Скин по нику</p>
                  <p className="mt-0.5 text-[11px] leading-4" style={{ color:'var(--color-text-secondary)' }}>Введите ник Minecraft: загрузится публичная текстура игрока, затем её можно назвать, проверить и применить как пресет.</p>
                  <div className="mt-3 flex gap-2">
                    <input value={nickname} maxLength={16} onChange={event => setNickname(event.target.value.replace(/[^A-Za-z0-9_]/g, ''))} onKeyDown={event => { if (event.key === 'Enter') void importSkinByNickname(); }} placeholder="Ник Minecraft" className="min-w-0 flex-1 px-3 py-2.5 text-sm outline-none" style={{ borderRadius:'var(--radius-button)', background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)' }} />
                    <button onClick={() => void importSkinByNickname()} disabled={!canEdit || nicknameLoading} className="flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs font-bold" style={{ borderRadius:'var(--radius-button)', background:'var(--color-primary)', color:'var(--color-primary-text)', opacity: !canEdit || nicknameLoading ? 0.55 : 1 }}>
                      {nicknameLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}{nicknameLoading ? 'Ищем…' : 'Загрузить'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4" style={card}>
              <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Мои пресеты</p><p className="mt-0.5 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>После применения скин автоматически сохраняется как ваш пресет.</p></div><span className="shrink-0 px-2 py-1 text-[10px] font-bold" style={{ borderRadius: 999, background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>{skinHistory.length}/{MAX_AUTO_SKINS}</span></div>
              <div className="mt-2 flex items-center gap-3 rounded-xl p-2.5" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg" style={{ background: 'var(--color-surface)' }}>
                  <SkinStand3D skinUrl={liveSkinUrl} capeUrl={activeCape?.url ?? null} model={model} height={56} cameraDistance={72} initialYaw={0.45} interactive={false} autoRotate />
                </div>
                <div><p className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>Никаких предустановленных Steve, Alex или чужих текстур.</p><p className="mt-0.5 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>Ваша текстура не дублируется, если она уже была сохранена.</p></div>
              </div>
              {skinHistory.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                  {skinHistory.map(skin => {
                    const selected = skin.id === selectedSkinId;
                    return (
                      <div key={skin.id} className="group overflow-hidden p-1.5" style={{ borderRadius: 'var(--radius-card)', background: 'var(--color-surface-2)', border: `2px solid ${selected ? '#37D67A' : 'var(--color-border)'}`, boxShadow: selected ? '0 0 0 1px rgba(55,214,122,.22), 0 8px 22px rgba(55,214,122,.16)' : 'none' }}>
                        <button onClick={() => void selectHistorySkin(skin)} disabled={!canEdit} title="Открыть и применить пресет" className="w-full text-left">
                          <div className="relative h-28 overflow-hidden rounded-lg" style={{ background: 'radial-gradient(ellipse at 50% 15%, var(--color-surface) 0%, var(--color-bg) 100%)' }}>
                            <SkinStand3D skinUrl={skin.dataUrl} capeUrl={skin.capeUrl ?? null} model={skin.model} height={112} cameraDistance={78} initialYaw={0.45} interactive={false} autoRotate />
                          </div>
                          <div className="px-1 pt-2">
                            <span className="block truncate text-[11px] font-bold" style={{ color: 'var(--color-text)' }}>{skin.name}</span>
                            <span className="block truncate pt-0.5 text-[9px]" style={{ color: selected ? '#37D67A' : 'var(--color-text-secondary)' }}>{selected ? 'Выбран' : skin.model === 'slim' ? 'Slim' : 'Classic'}{skin.capeUrl ? ' · Cape' : ''}</span>
                          </div>
                        </button>
                        <div className="flex gap-1 px-1 pb-1 pt-1">
                          <button onClick={() => void selectHistorySkin(skin)} disabled={!canEdit} title="Редактировать пресет" className="flex h-6 flex-1 items-center justify-center" style={{ borderRadius: 7, color: 'var(--color-primary)', background: 'var(--color-primary-dim)' }}><Pencil className="h-3 w-3" /></button>
                          <button onClick={() => deleteHistorySkin(skin)} title="Удалить пресет" className="flex h-6 w-7 items-center justify-center" style={{ borderRadius: 7, color: 'var(--color-error)', background: 'color-mix(in srgb, var(--color-error) 12%, transparent)' }}><Trash2 className="h-3 w-3" /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Тосты */}
      <AnimatePresence>
        {(error || ok) && (
          <motion.div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[90] flex items-center gap-2 px-4 py-2.5"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
            style={{
              borderRadius: 999, boxShadow: 'var(--shadow-md)',
              background: error ? 'rgba(231,76,60,0.16)' : 'var(--color-surface)',
              border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-border)'}`,
            }}>
            {error ? <AlertCircle className="w-4 h-4" style={{ color: 'var(--color-error)' }} />
              : <Shirt className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />}
            <span className="text-xs font-semibold" style={{ color: error ? 'var(--color-error)' : 'var(--color-text)' }}>{error || ok}</span>
            {error && <button onClick={() => setError('')}><X className="w-3.5 h-3.5" style={{ color: 'var(--color-error)' }} /></button>}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pending && (
          <SkinPreviewModal
            dataUrl={pending.dataUrl}
            model={pendingModel}
            name={pendingName}
            capes={profile?.capes ?? []}
            capeId={pendingCapeId}
            busy={applying}
            error={previewError}
            onName={setPendingName}
            onModel={setPendingModel}
            onCape={setPendingCapeId}
            onPickAnother={() => fileRef.current?.click()}
            onApply={applyPending}
            onClose={() => { if (!applying) { setPending(null); setPreviewError(''); setPendingName(''); setPendingCapeId(null); } }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default SkinSelectorPage;
