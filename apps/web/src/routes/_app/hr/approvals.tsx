import { createFileRoute, redirect } from '@tanstack/react-router';
import {
  HrApprovalsPage,
  parseHrApprovalsSearch,
  readsHr,
} from '../../../features/hr/hr-approvals-page';

export const Route = createFileRoute('/_app/hr/approvals')({
  validateSearch: parseHrApprovalsSearch,
  // Hidden from users without `hr.read`; the API lists only their own requests anyway.
  beforeLoad: ({ context }) => {
    if (!readsHr(context.me)) throw redirect({ to: '/' });
  },
  component: HrApprovalsRoute,
});

function HrApprovalsRoute() {
  return <HrApprovalsPage search={Route.useSearch()} />;
}
