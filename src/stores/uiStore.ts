import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type NavMode = 'notch' | 'sidebar';
export type NotchSide = 'top' | 'bottom' | 'left' | 'right';
export type FontFamily = 'theme' | 'inter' | 'space-grotesk' | 'manrope' | 'montserrat' | 'outfit' | 'play' | 'comfortaa' | 'oswald' | 'jetbrains-mono' | 'pixel';
export type InstallEffect = 'icon-drop' | 'zoom-bounce' | 'orbit' | 'shimmer' | 'none';
export type UiMode = 'new' | 'old';
export type PanelVersion = 'old' | 'new';
export type BackgroundFit = 'cover' | 'contain' | 'stretch' | 'tile';
export type BackgroundPosition = 'center' | 'top' | 'bottom' | 'left' | 'right';
export type NavAlignment = 'start' | 'center' | 'end';
export type NavShadow = 'none' | 'soft' | 'strong';
export type NavBorder = 'none' | 'subtle' | 'strong';
export type NavActiveIndicator = 'line' | 'dot' | 'pill';
export type NavLabels = 'icons' | 'hover' | 'always';
export type NavHoverIndicator = 'square' | 'circle' | 'none';
export type NavInteractionShape = 'square' | 'circle';
export type SearchDetailReturnPosition = 'remember' | 'top' | 'bottom';

export interface PanelAppearance {
  alignment: NavAlignment;
  gap: number;
  edgePadding: number;
  opacity: number;
  blur: number;
  shadow: NavShadow;
  border: NavBorder;
  activeIndicator: NavActiveIndicator;
  labels: NavLabels;
  hoverIndicator: NavHoverIndicator;
  interactionShape: NavInteractionShape;
}

export interface UiState {
  /** Тип навигации: выезжающая Notch-панель или боковая панель */
  navMode: NavMode;
  /** Сторона экрана, к которой прикреплена Notch-панель */
  notchSide: NotchSide;
  /** Размер зоны наведения (px), открывающей Notch-панель */
  notchHotzone: number;
  /** Панель всегда раскрыта */
  notchPinned: boolean;
  /** Разрешать открытие Notch Panel при наведении на tab/ручку */
  notchOpenOnTab: boolean;
  /** Дополнительная hover-зона прямо над ручкой Notch Panel, px */
  notchAboveHotzone: number;
  /** Масштаб только выезжающей Notch Panel, % */
  notchDockScale: number;
  /** Задержка закрытия Notch после выхода курсора, мс */
  notchCloseDelay: number;
  /** Порядок основных иконок Home, Discover, Skins и Library */
  navItemOrder: string[];
  /** Скорость открытия/закрытия навигации при hover, мс */
  navHoverMs: number;
  /** Ширина Notch-панели в процентах окна */
  notchWidth: number;
  /** Ширина Sidebar-панели в пикселях */
  sidebarWidth: number;
  /** Масштаб кнопок навигации в процентах */
  navItemScale: number;
  /** Масштаб всего интерфейса, % (как в Modrinth App) */
  uiScale: number;
  /** Радиус скругления, px */
  cornerRadius: number;
  /** Анимации интерфейса */
  animations: boolean;
  /** Размытие/стекло */
  blur: boolean;
  /** Компактный режим списков */
  compact: boolean;
  /** Пользовательский background (url или data:) */
  backgroundImage: string;
  backgroundOpacity: number;
  /** Импортированная .prtheme тема */
  customCss: string;
  customCssName: string;
  customCssEnabled: boolean;
  /** Принудительный цвет текста поверх темы: 'auto' — как задано темой */
  textColorOverride: 'auto' | 'black' | 'white';
  /** Сколько сборок показывать быстрым доступом в навигации (после Library) */
  navInstanceCount: number;
  /** Как отображать голову аккаунта в панели навигации */
  avatarStyle: 'face' | 'head';
  /** Выбранное семейство шрифта; theme использует шрифт текущей темы */
  fontFamily: FontFamily;
  /** Визуальный эффект при установке контента из поиска */
  installEffect: InstallEffect;
  /** Показывать неинтерактивную иконку источника в строках контента */
  showContentSourceIcon: boolean;
  /** Показывать имя игрока над большой 3D-моделью Skin Studio */
  showSkinStandName: boolean;
  /** Положение списка после возврата из страницы проекта */
  searchDetailReturnPosition: SearchDetailReturnPosition;
  /** Оболочка интерфейса: новый RedStone UI или совместимый старый стиль */
  uiMode: UiMode;
  /** Безопасная версия визуального оформления Notch/Sidebar панели */
  panelVersion: PanelVersion;
  /** Общая прозрачность интерактивного интерфейса поверх background */
  interfaceOpacity: number;
  /** Плотность и материал поверхностей интерфейса */
  surfaceOpacity: number;
  borderStrength: number;
  shadowStrength: number;
  motionSpeed: number;
  accentGlow: boolean;
  accentGlowStrength: number;
  /** Управление пользовательской картинкой фона */
  backgroundVideo: string;
  backgroundVideoOpacity: number;
  backgroundVideoMuted: boolean;
  backgroundFit: BackgroundFit;
  backgroundPosition: BackgroundPosition;
  backgroundBlur: number;
  backgroundSaturation: number;
  /** Затемняющая подложка для читаемого интерфейса поверх своего фона */
  backgroundReadability: number;
  /** Дополнительная настройка Notch/Sidebar без дублирования базовых размеров */
  navAlignment: NavAlignment;
  navGap: number;
  navEdgePadding: number;
  navOpacity: number;
  navBlur: number;
  navShadow: NavShadow;
  navBorder: NavBorder;
  navActiveIndicator: NavActiveIndicator;
  navLabels: NavLabels;
  /** Форма hover-обводки навигационного элемента */
  navHoverIndicator: NavHoverIndicator;
  /** Форма активного и нажатого элемента навигации */
  navInteractionShape: NavInteractionShape;
  /** Независимое оформление выезжающей Notch Panel */
  notchPanelAppearance: PanelAppearance;
  /** Независимое оформление постоянной Sidebar */
  sidebarPanelAppearance: PanelAppearance;
  /** Ширина рабочей области между навигацией и краями окна, % */
  contentWidth: number;
  /** Внутренний отступ рабочей области, px */
  contentInset: number;
  /** Высота нативной визуальной titlebar, px */
  titlebarHeight: number;
  /** Подстраивать цвет верхней панели под активную страницу */
  adaptiveTitlebarColor: boolean;

  set: <K extends keyof UiState>(key: K, value: UiState[K]) => void;
  reset: () => void;
}

const defaults = {
  navMode: 'sidebar' as NavMode,
  notchSide: 'top' as NotchSide,
  notchHotzone: 46,
  notchPinned: false,
  notchOpenOnTab: true,
  notchAboveHotzone: 0,
  notchDockScale: 100,
  notchCloseDelay: 180,
  navItemOrder: ['home', 'discover', 'skins', 'library'],
  navHoverMs: 180,
  notchWidth: 72,
  sidebarWidth: 88,
  navItemScale: 100,
  uiScale: 100,
  cornerRadius: 12,
  animations: true,
  blur: true,
  compact: false,
  backgroundImage: '',
  backgroundVideo: '',
  backgroundVideoOpacity: 42,
  backgroundVideoMuted: true,
  backgroundOpacity: 35,
  customCss: '',
  customCssName: '',
  customCssEnabled: true,
  textColorOverride: 'auto' as 'auto' | 'black' | 'white',
  navInstanceCount: 8,
  avatarStyle: 'head' as 'face' | 'head',
  fontFamily: 'theme' as FontFamily,
  installEffect: 'icon-drop' as InstallEffect,
  showContentSourceIcon: true,
  showSkinStandName: false,
  searchDetailReturnPosition: 'remember' as SearchDetailReturnPosition,
  uiMode: 'new' as UiMode,
  panelVersion: 'new' as PanelVersion,
  interfaceOpacity: 100,
  surfaceOpacity: 94,
  borderStrength: 100,
  shadowStrength: 100,
  motionSpeed: 100,
  accentGlow: true,
  accentGlowStrength: 100,
  backgroundFit: 'cover' as BackgroundFit,
  backgroundPosition: 'center' as BackgroundPosition,
  backgroundBlur: 0,
  backgroundSaturation: 100,
  backgroundReadability: 48,
  navAlignment: 'center' as NavAlignment,
  navGap: 4,
  navEdgePadding: 12,
  navOpacity: 92,
  navBlur: 18,
  navShadow: 'soft' as NavShadow,
  navBorder: 'subtle' as NavBorder,
  navActiveIndicator: 'line' as NavActiveIndicator,
  navLabels: 'icons' as NavLabels,
  navHoverIndicator: 'circle' as NavHoverIndicator,
  navInteractionShape: 'circle' as NavInteractionShape,
  notchPanelAppearance: {
    alignment: 'center' as NavAlignment, gap: 4, edgePadding: 12, opacity: 92, blur: 18,
    shadow: 'soft' as NavShadow, border: 'subtle' as NavBorder, activeIndicator: 'line' as NavActiveIndicator,
    labels: 'icons' as NavLabels, hoverIndicator: 'circle' as NavHoverIndicator, interactionShape: 'circle' as NavInteractionShape,
  },
  sidebarPanelAppearance: {
    alignment: 'start' as NavAlignment, gap: 4, edgePadding: 10, opacity: 100, blur: 0,
    shadow: 'none' as NavShadow, border: 'none' as NavBorder, activeIndicator: 'line' as NavActiveIndicator,
    labels: 'icons' as NavLabels, hoverIndicator: 'square' as NavHoverIndicator, interactionShape: 'square' as NavInteractionShape,
  },
  contentWidth: 100,
  contentInset: 0,
  titlebarHeight: 26,
  adaptiveTitlebarColor: true,
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      ...defaults,
      set: (key, value) => set({ [key]: value } as any),
      reset: () => set({ ...defaults }),
    }),
    {
      name: 'portal-launcher-ui',
      version: 6,
      migrate: (persisted: any, version) => {
        // Migrate only stock Title Bar heights from earlier releases; custom heights remain the user's choice.
        if (version < 3 && [28, 30, 32].includes(persisted?.titlebarHeight)) persisted.titlebarHeight = 26;
        // Stock layouts used Notch and showed only a few instance shortcuts.
        // Preserve an explicit custom mode/count, but migrate the old defaults.
        if (version < 4 && (persisted?.navMode === 'notch' || persisted?.navMode == null)) persisted.navMode = 'sidebar';
        if (version < 4 && [4, 5].includes(persisted?.navInstanceCount)) persisted.navInstanceCount = 8;
        if (version < 5 && persisted?.sidebarWidth === 148) persisted.sidebarWidth = 64;
        if (version < 6 && (!persisted?.sidebarWidth || persisted.sidebarWidth <= 72)) persisted.sidebarWidth = 88;
        if (version < 5 && persisted?.sidebarPanelAppearance?.labels === 'always') {
          persisted.sidebarPanelAppearance = {
            ...persisted.sidebarPanelAppearance,
            alignment: 'start', gap: 4, edgePadding: 10, opacity: 100, blur: 0,
            shadow: 'none', border: 'none', activeIndicator: 'line', labels: 'icons',
            hoverIndicator: 'square', interactionShape: 'square',
          };
        }
        return persisted;
      },
    },
  ),
);
