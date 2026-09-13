import { ReactNode } from 'react';
import { useLayoutStore } from '@/stores/layoutStore';
import { InnovativeShell } from '@/layouts/innovative/InnovativeShell';
import { ExtendedShell } from '@/layouts/extended/ExtendedShell';
import { MainLayout } from '@/components/layout/MainLayout';

/**
 * Выбирает оболочку интерфейса в зависимости от режима:
 *
 *  - standard   → текущий интерфейс без изменений (по умолчанию)
 *  - innovative → новая оболочка с полным редизайном страниц
 *  - extended   → портальная тема «чёрный + красный» с настраиваемым акцентом
 */
export function LayoutRouter({ children }: { children: ReactNode }) {
  const mode = useLayoutStore((s) => s.mode);
  const extended = useLayoutStore((s) => s.extended);

  if (mode === 'innovative') {
    return <InnovativeShell>{children}</InnovativeShell>;
  }

  if (mode === 'extended') {
    return <ExtendedShell>{children}</ExtendedShell>;
  }

  return <MainLayout>{children}</MainLayout>;
}
