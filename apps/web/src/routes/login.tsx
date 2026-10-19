import { createFileRoute, redirect } from '@tanstack/react-router';
import { LoginPage, type SignedOutReason } from '../features/account/login-page';
import { meQuery, safeRedirect } from '../lib/auth';

export const Route = createFileRoute('/login')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { redirect?: string; signedOut?: SignedOutReason } => ({
    ...(typeof search.redirect === 'string' && { redirect: safeRedirect(search.redirect) }),
    ...((search.signedOut === 'all' || search.signedOut === 'elsewhere') && {
      signedOut: search.signedOut,
    }),
  }),
  beforeLoad: async ({ context, search }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (me) throw redirect({ href: safeRedirect(search.redirect) });
  },
  component: LoginRoute,
});

function LoginRoute() {
  const { redirect: target, signedOut } = Route.useSearch();
  return <LoginPage redirect={target} signedOut={signedOut} />;
}
