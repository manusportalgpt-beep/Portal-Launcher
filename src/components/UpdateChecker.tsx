import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, Download, Clock, Rocket, Check } from 'lucide-react';
import { useUpdateStore, type UpdateNotification } from '@/stores/updateStore';
import { tauriUpdate, type UpdateInfo, type UpdateProgress } from '@/lib/tauri-bridge';

const CHECK_INTERVAL = 15 * 60 * 1000;
const SNOOZE_MINUTES = 30;

export function UpdateChecker() {
  const { addNotification, dismiss, snooze, isDismissed, isSnoozed, setLastChecked } = useUpdateStore();
  const [active, setActive] = useState<UpdateNotification | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const check = useCallback(async () => {
    try {
      const info = await tauriUpdate.check();
      if (!info || !info.version) return;
      setLastChecked(info.version);
      if (isDismissed(info.version)) return;
      if (isSnoozed()) return;
      const n: UpdateNotification = {
        version: info.version,
        body: info.body,
        publishedAt: info.published_at,
        htmlUrl: info.html_url,
        seenAt: Date.now(),
      };
      addNotification(n);
      setActive(n);
      setUpdateInfo(info);
    } catch {
      // silent
    }
  }, [addNotification, isDismissed, isSnoozed, setLastChecked]);

  useEffect(() => {
    const lastCheck = Number(localStorage.getItem('portal-update-last-check') || '0');
    if (Date.now() - lastCheck < CHECK_INTERVAL) return;
    localStorage.setItem('portal-update-last-check', String(Date.now()));
    check();
  }, [check]);

  // Listen for download progress events from Tauri
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const unlisten = await listen<UpdateProgress>('update-download-progress', (event) => {
          if (mounted) setProgress(event.payload);
        });
        unlistenRef.current = unlisten;
      } catch {
        // not in Tauri
      }
    })();
    return () => {
      mounted = false;
      unlistenRef.current?.();
    };
  }, []);

  const handleDismiss = useCallback(() => {
    if (active) dismiss(active.version);
    setActive(null);
    setUpdateInfo(null);
    setDownloading(false);
    setProgress(null);
    setDownloadedPath(null);
    setError(null);
  }, [active, dismiss]);

  const handleSnooze = useCallback(() => {
    snooze(SNOOZE_MINUTES);
    setActive(null);
    setUpdateInfo(null);
    setDownloading(false);
    setProgress(null);
    setDownloadedPath(null);
    setError(null);
  }, [snooze]);

  const handleDownload = useCallback(async () => {
    if (!updateInfo) return;
    setDownloading(true);
    setError(null);
    setProgress(null);
    try {
      const filePath = await tauriUpdate.download(updateInfo.download_url, updateInfo.file_name);
      setDownloadedPath(filePath);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setDownloading(false);
    }
  }, [updateInfo]);

  const handleInstall = useCallback(async () => {
    if (!downloadedPath) return;
    try {
      await tauriUpdate.install(downloadedPath);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [downloadedPath]);

  const isOpen = active !== null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 30, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed bottom-5 right-5 z-[800] flex flex-col overflow-hidden"
          style={{
            width: 400,
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-card, 12px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}
              >
                <Download className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                  Доступно обновление
                </p>
                <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                  Portal Launcher v{active?.version}
                </p>
              </div>
            </div>
            <button onClick={handleDismiss} className="p-1 rounded hover:bg-white/5">
              <X className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
            </button>
          </div>

          {/* Body */}
          <div className="px-4 py-3 flex flex-col gap-3">
            {/* Release name */}
            {active?.publishedAt && (
              <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                Опубликовано: {new Date(active.publishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            )}

            {/* Changelog */}
            {active?.body && (
              <div
                className="text-xs leading-relaxed max-h-28 overflow-y-auto pr-1"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {active.body.split('\n').slice(0, 10).map((line, i) => (
                  <p key={i} className={line.startsWith('#') ? 'font-bold mt-1' : line.startsWith('-') ? 'ml-2' : ''}>
                    {line.replace(/^#+\s*/, '')}
                  </p>
                ))}
              </div>
            )}

            {/* GitHub link */}
            {active?.htmlUrl && (
              <a
                href={active.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-[11px] hover:underline w-fit"
                style={{ color: 'var(--color-primary)' }}
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                Открыть страницу релиза
                <ExternalLink className="w-3 h-3" />
              </a>
            )}

            {/* Download progress */}
            {downloading && !downloadedPath && (
              <div className="flex flex-col gap-1.5">
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: 'var(--color-primary)' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${progress?.percent ?? 0}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                <p className="text-[11px] text-right" style={{ color: 'var(--color-text-tertiary)' }}>
                  {progress ? `${progress.percent}% — ${(progress.downloaded / 1048576).toFixed(1)} / ${(progress.total / 1048576).toFixed(1)} МБ` : 'Подготовка...'}
                </p>
              </div>
            )}

            {/* Error */}
            {error && (
              <p className="text-xs px-3 py-2 rounded" style={{ background: 'rgba(255,60,60,0.1)', color: '#ff5555' }}>
                {error}
              </p>
            )}
          </div>

          {/* Footer buttons */}
          <div
            className="flex items-center gap-2 px-4 py-3"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            {downloadedPath ? (
              <button
                onClick={handleInstall}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold"
                style={{
                  background: 'var(--color-success, #22c55e)',
                  color: '#fff',
                  borderRadius: 'var(--radius-button)',
                }}
              >
                <Check className="w-4 h-4" />
                Запустить обновление
              </button>
            ) : downloading ? (
              <div
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold opacity-70"
                style={{
                  background: 'var(--color-primary)',
                  color: 'var(--color-primary-text)',
                  borderRadius: 'var(--radius-button)',
                }}
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                >
                  <Download className="w-4 h-4" />
                </motion.div>
                Загрузка...
              </div>
            ) : (
              <button
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold"
                style={{
                  background: 'var(--color-primary)',
                  color: 'var(--color-primary-text)',
                  borderRadius: 'var(--radius-button)',
                }}
              >
                <Rocket className="w-4 h-4" />
                Обновить
              </button>
            )}
            <button
              onClick={handleSnooze}
              className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium"
              style={{
                background: 'var(--color-surface)',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-button)',
              }}
            >
              <Clock className="w-4 h-4" />
              Чуть позже
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
