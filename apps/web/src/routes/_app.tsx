import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AppShell } from '../components/app-shell';
import { reportHardware } from '../features/account/devices.queries';
import { useInstalledApp } from '../features/app/use-installed-app';
import { loadMe, needsTwoFactorSetup } from '../lib/auth';

/** Everything inside the shell requires a session; the API enforces it again on every call. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const me = await loadMe(context.queryClient);
    if (!me) throw redirect({ to: '/login', search: { redirect: location.href } });
    // Users who must use 2FA see nothing else until it is set up (F01 rule 15).
    if (needsTwoFactorSetup(me)) throw redirect({ to: '/setup-two-factor' });
    return { me };
  },
  component: AppLayout,
});

function AppLayout() {
  const { me } = Route.useRouteContext();
  // F01B rule 5: after sign-in and on every app load; the API keeps a session's first report.
  useEffect(() => {
    if (me.user.id) void reportHardware();
  }, [me.user.id]);
  useInstalledApp(me.user.id);
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
