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
export type SearchDetailReturnPosition = 'remember' | 'top' | 'bottom';

export interface UiState {
  /** Тип навигации: выезжающая Notch-панель или боковая панель */
  navMode: NavMode;
  /** Сторона экрана, к которой прикреплена Notch-панель */
  notchSide: NotchSide;
  /** Размер зоны наведения (px), открывающей Notch-панель */
  notchHotzone: number;
  /** Панель всегда раскрыта */
  notchPinned: boolean;
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
  /** Ширина рабочей области между навигацией и краями окна, % */
  contentWidth: number;
  /** Внутренний отступ рабочей области, px */
  contentInset: number;
  /** Высота нативной визуальной titlebar, px */
  titlebarHeight: number;

  set: <K extends keyof UiState>(key: K, value: UiState[K]) => void;
  reset: () => void;
}

const defaults = {
  navMode: 'notch' as NavMode,
  notchSide: 'top' as NotchSide,
  notchHotzone: 46,
  notchPinned: false,
  notchCloseDelay: 180,
  navItemOrder: ['home', 'discover', 'skins', 'library'],
  navHoverMs: 180,
  notchWidth: 72,
  sidebarWidth: 56,
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
  navInstanceCount: 5,
  avatarStyle: 'head' as 'face' | 'head',
  fontFamily: 'theme' as FontFamily,
  installEffect: 'icon-drop' as InstallEffect,
  showContentSourceIcon: true,
  showSkinStandName: true,
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
  navHoverIndicator: 'square' as NavHoverIndicator,
  contentWidth: 100,
  contentInset: 0,
  titlebarHeight: 32,
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      ...defaults,
      set: (key, value) => set({ [key]: value } as any),
      reset: () => set({ ...defaults }),
    }),
    { name: 'portal-launcher-ui' },
  ),
);
