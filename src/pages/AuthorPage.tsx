import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useAuthorAvatar } from '@/lib/author-avatar';
import { ArrowLeft, Download, ExternalLink, UserRound } from 'lucide-react';
import { Loader } from '@/components/uiverse/Uiv';

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
    <div className="h-full min-h-0 overflow-y-auto" style={{ background:'var(--color-bg)' }}>
      <div className="mx-auto max-w-6xl px-6 py-5">
        <button type="button" onClick={() => navigate(-1)}
          className="mb-5 inline-flex min-h-9 items-center gap-2 rounded-md px-2.5 text-sm transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
          style={{ color:'var(--color-text-secondary)' }}>
          <ArrowLeft size={16} /> Назад
        </button>

        {error && <p role="alert" className="rounded-md border p-4 text-sm" style={{ borderColor:'var(--color-border)', color:'var(--color-error)', background:'var(--color-surface)' }}>{error}</p>}
        {!profile && !error && (
          <div className="flex items-center justify-center gap-3 py-20">
            <Loader variant="loaders_AqFox_silent-quail-21" size={30} />
            <p className="text-sm" style={{ color:'var(--color-text-secondary)' }}>Загружаю профиль автора…</p>
          </div>
        )}

        {profile && (
          <>
            <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-start"
              style={{ borderColor:'var(--color-border)' }}>
              {profile.avatar_url || fallbackAvatar
                ? <img src={profile.avatar_url || fallbackAvatar || undefined} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
                : <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)' }}><UserRound size={30} /></div>}
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-xs font-semibold" style={{ color:'var(--color-text-secondary)' }}>{profile.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}</p>
                <h1 className="truncate text-2xl font-bold" style={{ color:'var(--color-text)' }}>{profile.display_name || profile.username}</h1>
                <p className="mt-2 text-sm" style={{ color:'var(--color-text-secondary)' }}>
                  {profile.projects.length} проектов <span aria-hidden="true">·</span> {profile.total_downloads.toLocaleString('ru-RU')} загрузок
                </p>
                {profile.bio && <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-6" style={{ color:'var(--color-text-secondary)' }}>{profile.bio}</p>}
              </div>
              <a href={profile.url} target="_blank" rel="noreferrer"
                className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
                style={{ borderColor:'var(--color-border)', color:'var(--color-text)' }}>
                <ExternalLink size={14} /> Открыть профиль
              </a>
            </header>

            <section className="pt-6" aria-labelledby="author-projects-heading">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 id="author-projects-heading" className="text-lg font-semibold" style={{ color:'var(--color-text)' }}>Проекты</h2>
                <span className="text-xs" style={{ color:'var(--color-text-tertiary)' }}>{profile.projects.length}</span>
              </div>
              {profile.projects.length === 0 ? (
                <p className="py-8 text-sm" style={{ color:'var(--color-text-secondary)' }}>У этого автора пока нет проектов.</p>
              ) : (
                <div className="divide-y" style={{ borderColor:'var(--color-border)' }}>
                  {profile.projects.map((p) => (
                    <button key={p.id || p.slug} type="button"
                      onClick={() => navigate(`/discover/${p.source}/${p.source === 'curseforge' ? p.id : (p.slug || p.id)}`)}
                      className="flex w-full items-start gap-3 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
                      style={{ color:'var(--color-text)' }}>
                      {p.icon_url ? <img src={p.icon_url} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
                        : <span className="h-12 w-12 shrink-0 rounded-md" style={{ background:'var(--color-surface-2)' }} />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{p.name}</span>
                        <span className="mt-1 line-clamp-2 block text-xs leading-5" style={{ color:'var(--color-text-secondary)' }}>{p.summary}</span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 pt-1 text-xs tabular-nums" style={{ color:'var(--color-text-tertiary)' }}>
                        <Download size={12} /> {p.downloads.toLocaleString('ru-RU')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default AuthorPage;
