import { createFileRoute, redirect } from '@tanstack/react-router';
import { LoginPage } from '../features/account/login-page';
import { meQuery, safeRedirect } from '../lib/auth';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' ? { redirect: safeRedirect(search.redirect) } : {},
  beforeLoad: async ({ context, search }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (me) throw redirect({ href: safeRedirect(search.redirect) });
  },
  component: LoginRoute,
});

function LoginRoute() {
  const { redirect: target } = Route.useSearch();
  return <LoginPage redirect={target} />;
}
