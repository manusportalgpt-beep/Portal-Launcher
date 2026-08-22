import goldenParticles from '@/assets/onboarding-backgrounds/golden-particles.jpg';
import azureWaves from '@/assets/onboarding-backgrounds/azure-waves.jpg';
import greenWaterfall from '@/assets/onboarding-backgrounds/green-waterfall.jpg';
import spectrumFlow from '@/assets/onboarding-backgrounds/spectrum-flow.jpg';
import watercolorMist from '@/assets/onboarding-backgrounds/watercolor-mist.jpg';
import cosmicLake from '@/assets/onboarding-backgrounds/cosmic-lake.jpg';
import violetFoldLight from '@/assets/onboarding-backgrounds/violet-fold-light.jpg';
import violetFoldDark from '@/assets/onboarding-backgrounds/violet-fold-dark.jpg';
import blueFold from '@/assets/onboarding-backgrounds/blue-fold.jpg';

export const ONBOARDING_BACKGROUNDS = [
  { id: 'golden-particles', name: 'Золотые частицы', src: goldenParticles, tone: 'dark' },
  { id: 'azure-waves', name: 'Голубые волны', src: azureWaves, tone: 'light' },
  { id: 'green-waterfall', name: 'Зелёный водопад', src: greenWaterfall, tone: 'dark' },
  { id: 'spectrum-flow', name: 'Спектральный поток', src: spectrumFlow, tone: 'dark' },
  { id: 'watercolor-mist', name: 'Акварельный туман', src: watercolorMist, tone: 'light' },
  { id: 'cosmic-lake', name: 'Космическое озеро', src: cosmicLake, tone: 'dark' },
  { id: 'violet-fold-light', name: 'Светлый фиолетовый изгиб', src: violetFoldLight, tone: 'light' },
  { id: 'violet-fold-dark', name: 'Тёмный фиолетовый изгиб', src: violetFoldDark, tone: 'dark' },
  { id: 'blue-fold', name: 'Синий изгиб', src: blueFold, tone: 'dark' },
] as const;
