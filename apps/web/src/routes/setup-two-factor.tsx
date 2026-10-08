import { createFileRoute, redirect } from '@tanstack/react-router';
import { TwoFactorSetupPage } from '../features/account/two-factor-setup-page';
import { meQuery } from '../lib/auth';

/** Outside the shell: users who must set up 2FA see nothing else until they do (F01 rule 15). */
export const Route = createFileRoute('/setup-two-factor')({
  beforeLoad: async ({ context, location, cause }) => {
    const me = await context.queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
    if (!me) throw redirect({ to: '/login', search: { redirect: location.href } });
    // 2FA turns on before the backup codes show: only a fresh visit leaves for the account page,
    // not a reload of the route while the codes are on screen (a cancelled "leave").
    if (me.twoFactor.enabled && cause !== 'stay') throw redirect({ to: '/account' });
    return { me };
  },
  component: SetupRoute,
});

function SetupRoute() {
  const { me } = Route.useRouteContext();
  return <TwoFactorSetupPage required={me.twoFactor.required} />;
}
