import { createFileRoute, redirect } from '@tanstack/react-router';
import { AuditPage, parseAuditSearch } from '../../features/audit/audit-page';
import { can } from '../../lib/auth';

export const Route = createFileRoute('/_app/audit')({
  validateSearch: parseAuditSearch,
  // Hidden from users without audit.read; the API refuses them anyway.
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'audit.read')) throw redirect({ to: '/' });
  },
  component: AuditRoute,
});

function AuditRoute() {
  return <AuditPage search={Route.useSearch()} />;
}
