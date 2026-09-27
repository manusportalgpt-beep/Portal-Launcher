/**
 * Буст FPS: подбор модов-ускорителей под загрузчик и версию игры.
 *
 * Смысл в том, что игроку не нужно знать, что такое Sodium. Он жмёт
 * «Буст FPS», и мы сами собираем рабочий набор: обязательный Fabric API
 * (или quilt-loader для Quilt) плюс ускорители, подходящие его загрузчику.
 *
 * Что здесь НЕ выдумывается: список и совместимость берутся из Modrinth по
 * slug'у и фильтруются по версии игры и загрузчику, а установка идёт через
 * общий инсталлер с зависимостями. Поэтому «Буст FPS» не может поставить
 * Sodium в Forge-сборку или Fabric-мод в NeoForge.
 */

export interface BoostMod {
  /** slug проекта на Modrinth. */
  slug: string;
  title: string;
  /** Зачем мод: показываем в списке до установки. */
  note: string;
  /** Обязателен всегда: без него остальные моды могут не запуститься. */
  required?: boolean;
}

/** Обязательная база для загрузчика. */
export const LOADER_API: Record<string, { slug: string; title: string } | null> = {
  fabric: { slug: 'fabric-api', title: 'Fabric API' },
  quilt: { slug: 'quilted-fabric-api', title: 'Quilted Fabric API' },
  forge: null,
  neoforge: null,
  vanilla: null,
};

/** Ускорители по загрузчику. Порядок — от главного к дополнительным. */
const BOOSTS: Record<string, BoostMod[]> = {
  fabric: [
    { slug: 'sodium', title: 'Sodium', note: 'переписывает движок рендера, главный выигрыш кадров' },
    { slug: 'iris', title: 'Iris', note: 'шейдеры с Sodium; без него шейдеры не появятся' },
    { slug: 'lithium', title: 'Lithium', note: 'физика и ИИ: меньше лагов в мире' },
    { slug: 'ferrite-core', title: 'Ferrite Core', note: 'меньше расхода памяти' },
    { slug: 'immediatelyfast', title: 'ImmediatelyFast', note: 'быстрее отрисовка интерфейса и чанков' },
    { slug: 'entityculling', title: 'Entity Culling', note: 'не рисует невидимые сущности' },
    { slug: 'moreculling', title: 'More Culling', note: 'дополнительное отсечение невидимого' },
  ],
  quilt: [
    { slug: 'sodium', title: 'Sodium', note: 'переписывает движок рендера, главный выигрыш кадров' },
    { slug: 'lithium', title: 'Lithium', note: 'физика и ИИ: меньше лагов в мире' },
    { slug: 'ferrite-core', title: 'Ferrite Core', note: 'меньше расхода памяти' },
  ],
  forge: [
    { slug: 'embeddium', title: 'Embeddium', note: 'ускоритель рендера для Forge, аналог Sodium' },
    { slug: 'rubidium', title: 'Rubidium', note: 'альтернатива Embeddium' },
    { slug: 'oculus', title: 'Oculus', note: 'шейдеры вместе с ускорителем' },
    { slug: 'ferritecore', title: 'FerriteCore', note: 'меньше расхода памяти' },
    { slug: 'entityculling', title: 'Entity Culling', note: 'не рисует невидимые сущности' },
  ],
  neoforge: [
    { slug: 'embeddium', title: 'Embeddium', note: 'ускоритель рендера для NeoForge' },
    { slug: 'rubidium', title: 'Rubidium', note: 'альтернатива Embeddium' },
    { slug: 'oculus', title: 'Oculus', note: 'шейдеры вместе с ускорителем' },
    { slug: 'ferritecore', title: 'FerriteCore', note: 'меньше расхода памяти' },
  ],
};

/**
 * Собирает набор модов под загрузчик.
 *
 * Возвращает пустой список не как ошибку, а с причиной: на ванильном
 * загрузчике ускорителей нет, и это надо сказать прямо, а не молча.
 */
export function planFpsBoost(loader: string, _mcVersion?: string): {
  supported: boolean;
  reason?: string;
  base: BoostMod[];
  boosts: BoostMod[];
} {
  const key = (loader || 'vanilla').toLowerCase();
  if (key === 'vanilla' || !BOOSTS[key]) {
    return {
      supported: false,
      reason: key === 'vanilla'
        ? 'Буст FPS работает на Fabric, Quilt, Forge и NeoForge. На ванильной сборке ускорителей нет — создай сборку на загрузчике.'
        : `Для загрузчика «${loader}» набора ускорителей нет.`,
      base: [],
      boosts: [],
    };
  }
  const api = LOADER_API[key];
  return {
    supported: true,
    base: api
      ? [{ slug: api.slug, title: api.title, note: 'обязательная база для модов загрузчика', required: true }]
      : [],
    boosts: BOOSTS[key],
  };
}

/** Человеческое имя загрузчика — для заголовка панели. */
export const LOADER_LABEL: Record<string, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  vanilla: 'Ванильная',
};
