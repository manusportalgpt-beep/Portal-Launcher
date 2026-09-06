import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useAuthorAvatar } from '@/lib/author-avatar';
import { ArrowLeft, Download, ExternalLink } from 'lucide-react';

type Project = { id: string; slug: string; name: string; summary: string; icon_url?: string; downloads: number; source: string };
type Profile = {
  source: string; username: string; display_name?: string; avatar_url?: string; bio?: string;
  url: string; projects: Project[]; total_downloads: number;
};

/** Страница автора мода прямо в лаунчере: Modrinth и CurseForge — каждая своя. */
export function AuthorPage() {
  const { source, name } = useParams<{ source: string; name: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fallbackAvatar = useAuthorAvatar(name, source);

  useEffect(() => {
    if (!source || !name) return;
    const cmd = source === 'curseforge' ? 'get_curseforge_author' : 'get_modrinth_author';
    const rawAuthorId = new URLSearchParams(location.search).get('authorId');
    const parsedAuthorId = rawAuthorId ? Number(rawAuthorId) : null;
    const args = source === 'curseforge' ? { author: name, authorId: Number.isSafeInteger(parsedAuthorId) ? parsedAuthorId : null } : { user: name };
    invoke<Profile>(cmd, args).then(setProfile).catch((e) => setError(String(e)));
  }, [source, name, location.search]);

  return (
    <div className="h-full overflow-y-auto scroll-area p-6 pb-10 text-[var(--color-text)]">
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-2 text-sm opacity-70 hover:opacity-100">
        <ArrowLeft size={16} /> Назад
      </button>

      {error && <p className="text-red-400">{error}</p>}
      {!profile && !error && <p className="opacity-60">Загружаю профиль автора…</p>}

      {profile && (
        <>
          <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-5">
            {profile.avatar_url || fallbackAvatar ? (
              <img src={profile.avatar_url || fallbackAvatar || ''} alt={profile.username} className="h-20 w-20 rounded-2xl object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/10 text-2xl font-bold">
                {profile.username.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{profile.display_name || profile.username}</h1>
              <p className="text-sm opacity-60">
                {profile.source === 'modrinth' ? 'Modrinth' : 'CurseForge'} · {profile.projects.length} проектов ·{' '}
                {profile.total_downloads.toLocaleString('ru-RU')} загрузок
              </p>
              {profile.bio && <p className="mt-2 text-sm opacity-80">{profile.bio}</p>}
            </div>
            <a href={profile.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20">
              <ExternalLink size={14} /> Открыть в браузере
            </a>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {profile.projects.map((p) => (
              <button
                key={p.id || p.slug}
                onClick={() => navigate(`/discover/${p.source}/${p.source === 'curseforge' ? p.id : (p.slug || p.id)}`)}
                className="flex gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-left transition hover:border-white/25 hover:bg-white/10"
              >
                {p.icon_url ? (
                  <img src={p.icon_url} alt={p.name} className="h-12 w-12 rounded-lg object-cover" />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-white/10" />
                )}
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="line-clamp-2 text-xs opacity-60">{p.summary}</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-xs opacity-50">
                    <Download size={11} /> {p.downloads.toLocaleString('ru-RU')}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default AuthorPage;
