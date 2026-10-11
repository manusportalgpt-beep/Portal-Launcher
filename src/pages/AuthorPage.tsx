import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useAuthorAvatar } from '@/lib/author-avatar';
import { ArrowLeft, Download, ExternalLink } from 'lucide-react';
import { AuthorCard, Loader } from '@/components/uiverse/Uiv';

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

  // Пункт 10: автор открывается карточкой поверх интерфейса, а не отдельной
  // страницей. Маршрут и все ссылки на него остались прежними — меняется
  // только подача, поэтому ничего не ломается.
  return (
    <div
      className="fixed inset-0 z-[900] flex items-start justify-center overflow-y-auto p-6"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }}
      onClick={() => navigate(-1)}
    >
      <div
        className="mt-10 w-full max-w-4xl rounded-3xl p-6 pb-10"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-2 text-sm opacity-70 hover:opacity-100">
          <ArrowLeft size={16} /> Назад
        </button>

        {error && <p className="text-red-400">{error}</p>}
        {!profile && !error && (
          <div className="flex items-center justify-center gap-3 py-16">
            <Loader variant="loaders_AqFox_silent-quail-21" size={30} />
            <p className="opacity-60 text-sm">Загружаю профиль автора…</p>
          </div>
        )}

        {profile && (
          <>
            <div className="mb-5">
              <AuthorCard
                name={profile.display_name || profile.username}
                handle={`${profile.source === 'modrinth' ? 'Modrinth' : 'CurseForge'} · ${profile.projects.length} проектов · ${profile.total_downloads.toLocaleString('ru-RU')} загрузок`}
                description={profile.bio}
                avatarUrl={profile.avatar_url || fallbackAvatar || undefined}
              />
            </div>

            <div className="mb-4 flex justify-end">
              <a href={profile.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/20">
                <ExternalLink size={14} /> Открыть в браузере
              </a>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
    </div>
  );
}

export default AuthorPage;
