import { ReactNode } from 'react';
import { useLayoutStore } from '@/stores/layoutStore';
import { InnovativeShell } from '@/layouts/innovative/InnovativeShell';
import { MainLayout } from '@/components/layout/MainLayout';

/**
 * Выбирает оболочку интерфейса в зависимости от режима:
 *
 *  - standard   → текущий интерфейс без изменений (по умолчанию)
 *  - innovative → новая оболочка с полным редизайном страниц
 *  - extended   → стандартный интерфейс с настраиваемыми иконками/кнопками
 */
export function LayoutRouter({ children }: { children: ReactNode }) {
  const mode = useLayoutStore((s) => s.mode);
  const extended = useLayoutStore((s) => s.extended);

  if (mode === 'innovative') {
    return <InnovativeShell>{children}</InnovativeShell>;
  }

  if (mode === 'extended') {
    return (
      <MainLayout
        extendedAccent={extended.colorAccent}
        extendedCompact={extended.compactMode}
        extendedIcons={extended.sidebarIcons}
        extendedOrder={extended.sidebarOrder}
      >
        {children}
      </MainLayout>
    );
  }

  return <MainLayout>{children}</MainLayout>;
}
