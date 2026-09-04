import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, RefreshCw, ArrowRight } from 'lucide-react';
import { useUpdateStore, type UpdateNotification } from '@/stores/updateStore';

const REPO_OWNER = 'manusportalgpt-beep';
const REPO_NAME = 'Portal-Launcher';
const CURRENT_VERSION = '1.0.3';
const CHECK_INTERVAL = 15 * 60 * 1000;
const AUTO_DISMISS_MS = 30_000;

async function fetchLatestRelease(): Promise<{ tag: string; body: string; published: string; htmlUrl: string } | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      tag: (data.tag_name ?? '').replace(/^v/i, ''),
      body: data.body ?? '',
      published: data.published_at ?? '',
      htmlUrl: data.html_url ?? '',
    };
  } catch {
    return null;
  }
}

function parseVersion(v: string): number[] {
  return v.split('.').map(Number).filter(n => !isNaN(n));
}

function isNewer(a: string, b: string): boolean {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const na = va[i] ?? 0;
    const nb = vb[i] ?? 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return false;
}

export function UpdateChecker() {
  const { addNotification, dismiss, isDismissed, setLastChecked, lastCheckedVersion } = useUpdateStore();
  const [active, setActive] = useState<UpdateNotification | null>(null);
  const [progress, setProgress] = useState(0);

  const check = useCallback(async () => {
    const release = await fetchLatestRelease();
    if (!release || !release.tag) return;
    setLastChecked(release.tag);
    if (!isNewer(release.tag, CURRENT_VERSION)) return;
    if (isDismissed(release.tag)) return;
    const n: UpdateNotification = {
      version: release.tag,
      body: release.body,
      publishedAt: release.published,
      htmlUrl: release.htmlUrl,
      seenAt: Date.now(),
    };
    addNotification(n);
    setActive(n);
    setProgress(100);
  }, [addNotification, isDismissed, setLastChecked]);

  useEffect(() => {
    const lastCheck = Number(localStorage.getItem('portal-update-last-check') || '0');
    if (Date.now() - lastCheck < CHECK_INTERVAL) return;
    localStorage.setItem('portal-update-last-check', String(Date.now()));
    check();
  }, [check]);

  useEffect(() => {
    if (!active) return;
    setProgress(100);
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 1 - elapsed / AUTO_DISMISS_MS);
      setProgress(remaining * 100);
      if (remaining <= 0) {
        clearInterval(interval);
        setActive(null);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [active]);

  const handleDismiss = useCallback(() => {
    if (active) dismiss(active.version);
    setActive(null);
  }, [active, dismiss]);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0, y: 20, x: 0 }}
          animate={{ opacity: 1, y: 0, x: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed bottom-5 left-5 z-[800] flex flex-col overflow-hidden"
          style={{ width: 360, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8, boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}
        >
          {/* Progress bar */}
          <div className="h-0.5 shrink-0" style={{ background: 'var(--color-border)' }}>
            <div className="h-full transition-all duration-100" style={{ width: `${progress}%`, background: 'var(--color-primary)' }} />
          </div>

          <div className="px-4 py-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                New version available
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                Portal Launcher v{active.version}
              </p>
              {active.body && (
                <div className="mt-2 text-[11px] leading-relaxed max-h-20 overflow-y-auto" style={{ color: 'var(--color-text-tertiary)' }}>
                  {active.body.split('\n').slice(0, 5).join('\n')}
                </div>
              )}
              <div className="mt-2.5 flex items-center gap-2">
                <a
                  href={active.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium"
                  style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', borderRadius: 4 }}
                >
                  Download <ArrowRight className="w-3 h-3" />
                </a>
                <button
                  onClick={handleDismiss}
                  className="px-3 py-1.5 text-[11px] font-medium"
                  style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 4 }}
                >
                  Dismiss
                </button>
              </div>
            </div>
            <button onClick={handleDismiss} className="p-0.5 hover:opacity-70 shrink-0">
              <X className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
