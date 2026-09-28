import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  const { t } = useTranslation();
  return (
    <div className="shell">
      <header className="shell-header">
        <span className="shell-brand">{t('app.name')}</span>
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
