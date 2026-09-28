import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { AppShell } from '../components/app-shell';
import { meQuery, needsTwoFactorSetup } from '../lib/auth';

/** Everything inside the shell requires a session; the API enforces it again on every call. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) throw redirect({ to: '/login', search: { redirect: location.href } });
    // Users who must use 2FA see nothing else until it is set up (F01 rule 15).
    if (needsTwoFactorSetup(me)) throw redirect({ to: '/setup-two-factor' });
    return { me };
  },
  component: AppLayout,
});

function AppLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
