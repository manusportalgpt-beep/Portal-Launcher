import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Routes, Route, Navigate } from 'react-router-dom';
import { SplashScreen } from '@/components/splash/SplashScreen';
import { MainLayout } from '@/components/layout/MainLayout';
import { HomePage } from '@/pages/HomePage';
import { DiscoverPage } from '@/pages/DiscoverPage';
import { LibraryPage } from '@/pages/LibraryPage';
import { InstancesPage } from '@/pages/InstancesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { InstanceSettings } from '@/pages/InstanceSettings';
import { ModDetail } from '@/pages/ModDetail';
import { SkinSelectorPage } from '@/pages/SkinSelectorPage';
import { GalleryPage } from '@/pages/GalleryPage';
import { FindProjectsPage } from '@/pages/FindProjectsPage';
import { AuthorPage } from '@/pages/AuthorPage';
import { ControlCenterPage } from '@/pages/ControlCenterPage';
import { TitleBar } from '@/components/window/WindowControls';
import { useThemeStore } from '@/stores/themeStore';
import { useTheme } from '@/lib/theme-engine';
import { useUiEffects } from '@/lib/ui-engine';
import { useUiStore } from '@/stores/uiStore';
import { useLanguageStore } from '@/stores/languageStore';
import i18n from '@/i18n';
import { BottomProgressBar } from '@/components/BottomProgressBar';
import { InstallEffectOverlay } from '@/components/InstallEffectOverlay';
import { DialogHost } from '@/components/DialogHost';
import { BackgroundMusicPlayer } from '@/components/BackgroundMusicPlayer';
import { BackgroundVideo } from '@/components/BackgroundVideo';
import { GlobalHotkeys } from '@/components/GlobalHotkeys';
import { FirstLaunchExperience } from '@/components/FirstLaunchExperience';
import { useNotifStore } from '@/stores/notificationStore';
import { useInstanceStore } from '@/stores/instanceStore';
import { useAuthStore } from '@/stores/authStore';
import { useLaunchStore } from '@/stores/launchStore';
import { invoke } from '@/lib/invoke-shim';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

const WELCOME_KEY = 'portal-welcome-shown';

function App() {
  const [loading, setLoading] = useState(false);
  const themeId = useThemeStore((state) => state.themeId);
  const customThemes = useThemeStore((state) => state.customThemes);
  const textColorOverride = useUiStore(s => s.textColorOverride);
  const fontFamily = useUiStore(s => s.fontFamily);
  const language = useLanguageStore(s => s.lang);
  const setLaunchStatus = useLaunchStore(s => s.setStatus);
  useTheme(themeId, textColorOverride, fontFamily, customThemes);
  useEffect(() => {
    void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<any>('launch-status', event => {
      const id = String(event.payload?.instance_id ?? '');
      const status = String(event.payload?.status ?? '');
      if (!id) return;
      setLaunchStatus(id, status === 'running' ? 'running' : ['stopped', 'error', 'crashed', 'prepared'].includes(status) ? 'idle' : 'launching');
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [setLaunchStatus]);

  // A desktop shortcut starts the packaged app with an instance id. Hide the
  // launcher shell while that instance is starting so the shortcut behaves as
  // a direct Minecraft launch, then show Portal Launcher after the game exits.
  useEffect(() => {
    let disposed = false;
    let shortcutLaunch = false;
    const win = getCurrentWindow();
    const unlistenPromise = listen('game-exited', async () => {
      if (shortcutLaunch && !disposed) {
        try { await win.show(); await win.setFocus(); } catch {}
      }
    });
    void invoke<string | null>('get_startup_launch_instance').then(async (instanceId) => {
      if (!instanceId || disposed) return;
      shortcutLaunch = true;
      try { await win.hide(); } catch {}
      try {
        const result = await invoke<{ pid?: number | null }>('launch_instance', {
          instanceId,
          quickPlay: null,
          username: null,
          uuid: null,
          accessToken: null,
          provider: null,
        });
        // On the first shortcut click Minecraft may only be prepared. Show the
        // launcher in that case so the user can press Launch again; a real
        // direct launch keeps the shell hidden until game-exited.
        if (!result?.pid) {
          try { await win.show(); await win.setFocus(); } catch {}
        }
      } catch (error) {
        try { await win.show(); await win.setFocus(); } catch {}
        console.error('Direct shortcut launch failed:', error);
      }
    }).catch(() => {});
    return () => {
      disposed = true;
      void unlistenPromise.then(unlisten => unlisten());
    };
  }, []);
  useUiEffects();
  const addNotif = useNotifStore(s => s.add);
  const instances = useInstanceStore(s => s.instances);
  const authAccounts = useAuthStore(s => s.accounts);
  const addAccount = useAuthStore(s => s.addAccount);

  // Резервное восстановление аккаунта: если основное хранилище (в браузере)
  // почему-то пришло пустым при старте, пробуем восстановить из Rust-моста —
  // безопасно, т.к. выход из аккаунта теперь чистит оба хранилища синхронно.
  useEffect(() => {
    if (authAccounts.length > 0) return;
    invoke<any>('msa_get_account').then(acc => {
      if (acc && acc.uuid && acc.username) {
        const provider = acc.provider === 'elyby' || acc.provider === 'offline'
          ? acc.provider
          : 'microsoft';
        addAccount({
          uuid: acc.uuid,
          username: acc.username,
          skinUrl: acc.skin_url ?? undefined,
          avatarUrl: provider === 'elyby'
            ? `https://skinsystem.ely.by/skins/${encodeURIComponent(acc.username)}.png`
            : `https://mc-heads.net/head/${acc.uuid}/64`,
          accessToken: acc.access_token,
          refreshToken: acc.refresh_token,
          tokenExpiry: (acc.expires_at ?? 0) * 1000,
          isDemo: provider === 'offline',
          provider,
        });
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Welcome notification — shown once when there are no instances
  useEffect(() => {
    if (loading) return;
    const shown = localStorage.getItem(WELCOME_KEY);
    if (!shown && instances.length === 0) {
      localStorage.setItem(WELCOME_KEY, '1');
      addNotif({
        type: 'system',
        title: 'Welcome to Portal Launcher!',
        body: 'Thank you for installing Portal Launcher. We\'re glad you\'ll be using it — enjoy!',
      });
    }
  }, [loading]);

  return (
    <>
      <div className="relative flex h-screen min-h-0 flex-col overflow-hidden bg-transparent text-[var(--color-text)]">
      <BackgroundVideo />
      <div className="relative z-10 flex h-full min-h-0 flex-col" style={{ opacity: 'var(--portal-interface-opacity, 1)' }}>
      <GlobalHotkeys />
      <TitleBar />
      <AnimatePresence>
        {loading ? <SplashScreen onComplete={() => setLoading(false)} /> : null}
      </AnimatePresence>
      {!loading && (
        <div className="flex-1 min-h-0">
        <MainLayout>
          <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/control-center" element={<ControlCenterPage />} />
            <Route path="/discover" element={<DiscoverPage />} />
            <Route path="/discover/:source/:modId" element={<ModDetail />} />
            <Route path="/find-projects" element={<FindProjectsPage />} />
            <Route path="/author/:source/:name" element={<AuthorPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/library/:id" element={<LibraryPage />} />
            <Route path="/instances" element={<InstancesPage />} />
            <Route path="/instances/:id/settings" element={<InstanceSettings />} />
            <Route path="/skins" element={<SkinSelectorPage />} />
            <Route path="/gallery" element={<GalleryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/:section" element={<SettingsPage />} />
          </Routes>
          <BottomProgressBar />
        </MainLayout>
        </div>
      )}
      <InstallEffectOverlay />
      {!loading && <BackgroundMusicPlayer />}
      <DialogHost />
      {!loading && <FirstLaunchExperience />}
      </div>
      </div>
    </>
  );
}

export default App;
