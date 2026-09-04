import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listen } from '@tauri-apps/api/event';
import { Download } from 'lucide-react';

interface DownloadEvent {
  stage: string;
  current: number;
  total: number;
  message: string;
  percent: number;
  isInstall?: boolean;
}


interface JavaDownloadEvent {
  percent: number;
  message: string;
  version: number;
}

export function DownloadProgressOverlay() {
  const [dlEvent, setDlEvent] = useState<DownloadEvent | null>(null);
  const [javaEvt, setJavaEvt] = useState<JavaDownloadEvent | null>(null);

  useEffect(() => {
    let uns: Array<() => void> = [];

    const handleGameProgress = (payload: DownloadEvent, isInstall: boolean) => {
      setDlEvent({
        stage: payload.stage || 'install',
        current: Number(payload.current || 0),
        total: Number(payload.total || 0),
        message: payload.message || 'Загрузка Minecraft',
        percent: Math.max(0, Math.min(100, Number(payload.percent || 0))),
        isInstall,
      });
      if (Number(payload.percent || 0) >= 100) setTimeout(() => setDlEvent(null), 3000);
    };
    listen<DownloadEvent>('download-progress', e => handleGameProgress(e.payload, false)).then(f => uns.push(f));
    listen<DownloadEvent>('install-progress', e => handleGameProgress(e.payload, true)).then(f => uns.push(f));

    listen<JavaDownloadEvent>('java-download', e => {
      setJavaEvt(e.payload);
      if (e.payload.percent >= 100) setTimeout(() => setJavaEvt(null), 3000);
    }).then(f => uns.push(f));

    return () => uns.forEach(fn => fn());
  }, []);


  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 items-end pointer-events-none">
      {/* Download progress */}
      <AnimatePresence>
        {dlEvent && (
          <motion.div key="dl" className="w-72 rounded-xl p-3 pointer-events-auto"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}
            initial={{ x: 80, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 80, opacity: 0 }}>
            <div className="flex items-center gap-2 mb-2">
              <Download className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-primary)' }} />
              <span className="text-xs font-semibold flex-1 truncate" style={{ color: 'var(--color-text)' }}>{dlEvent.message || 'Загрузка Minecraft'}</span>
              <span className="text-xs font-bold" style={{ color: 'var(--color-primary)' }}>{dlEvent.percent}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
              <motion.div className="h-full rounded-full" style={{ background: 'var(--color-primary)' }}
                animate={{ width: `${dlEvent.percent}%` }} transition={{ type: 'spring', stiffness: 60 }} />
            </div>
            {dlEvent.isInstall && dlEvent.total > 0 && (
              <p className="text-[10px] mt-1.5" style={{ color: 'var(--color-text-tertiary)' }}>Файл {dlEvent.current} из {dlEvent.total}</p>
            )}
            <p className="text-[10px] mt-1.5 truncate" style={{ color: 'var(--color-text-tertiary)' }}>{dlEvent.message}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Java download */}
      <AnimatePresence>
        {javaEvt && (
          <motion.div key="java" className="w-72 rounded-xl p-3 pointer-events-auto"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}
            initial={{ x: 80, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 80, opacity: 0 }}>
            <div className="flex items-center gap-2 mb-2">
              <Download className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-primary)' }} />
              <span className="text-xs font-semibold flex-1 truncate" style={{ color: 'var(--color-text)' }}>{javaEvt.message || `Установка Java ${javaEvt.version}`}</span>
              <span className="text-xs font-bold" style={{ color: 'var(--color-primary)' }}>{javaEvt.percent}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
              <motion.div className="h-full rounded-full" style={{ background: 'var(--color-primary)' }}
                animate={{ width: `${javaEvt.percent}%` }} transition={{ type: 'spring', stiffness: 60 }} />
            </div>
            <p className="text-[10px] mt-1.5 truncate" style={{ color: 'var(--color-text-tertiary)' }}>{javaEvt.message}</p>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
