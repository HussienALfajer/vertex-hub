import { createFileRoute, redirect } from '@tanstack/react-router';
import { TwoFactorSetupPage } from '../features/account/two-factor-setup-page';
import { meQuery } from '../lib/auth';

/** Outside the shell: users who must set up 2FA see nothing else until they do (F01 rule 15). */
export const Route = createFileRoute('/setup-two-factor')({
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
    if (!me) throw redirect({ to: '/login', search: { redirect: location.href } });
    if (me.twoFactor.enabled) throw redirect({ to: '/account' });
    return { me };
  },
  component: SetupRoute,
});

function SetupRoute() {
  const { me } = Route.useRouteContext();
  return <TwoFactorSetupPage required={me.twoFactor.required} />;
}
