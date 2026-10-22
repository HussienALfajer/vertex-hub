import { createFileRoute, redirect } from '@tanstack/react-router';
import { readsHr } from '../../../features/hr/hr-approvals-page';
import { HrTodayPage, parseHrTodaySearch } from '../../../features/hr/hr-today-page';

export const Route = createFileRoute('/_app/hr/today')({
  validateSearch: parseHrTodaySearch,
  // The board is for `hr.read` holders; the API answers 403 to others.
  beforeLoad: ({ context }) => {
    if (!readsHr(context.me)) throw redirect({ to: '/' });
  },
  component: HrTodayRoute,
});

function HrTodayRoute() {
  return <HrTodayPage search={Route.useSearch()} />;
}
