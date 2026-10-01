import { createFileRoute, redirect } from '@tanstack/react-router';
import {
  ApprovalsPage,
  approvalTabsFor,
  parseApprovalsSearch,
} from '../../../features/approvals/approvals-page';

export const Route = createFileRoute('/_app/approvals/')({
  validateSearch: parseApprovalsSearch,
  // Hidden from users with no queue to act on; the API refuses them anyway.
  beforeLoad: ({ context }) => {
    if (approvalTabsFor(context.me).length === 0) throw redirect({ to: '/tasks' });
  },
  component: ApprovalsRoute,
});

function ApprovalsRoute() {
  return <ApprovalsPage search={Route.useSearch()} />;
}
