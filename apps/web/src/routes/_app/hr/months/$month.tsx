import { createFileRoute, redirect } from '@tanstack/react-router';
import { businessDate } from '@vertex-hub/contracts';
import {
  HrMonthPage,
  parseHrMonthSearch,
  readsMonths,
} from '../../../../features/hr/hr-month-page';
import { monthParam } from '../../../../lib/search-params';

export const Route = createFileRoute('/_app/hr/months/$month')({
  validateSearch: parseHrMonthSearch,
  // The sheet is for `hr.read` and `salaries.read` holders; the API answers 403 to others.
  beforeLoad: ({ context, params }) => {
    if (!readsMonths(context.me)) throw redirect({ to: '/' });
    if (!monthParam(params.month)) {
      throw redirect({
        to: '/hr/months/$month',
        params: { month: businessDate().slice(0, 7) },
        replace: true,
      });
    }
  },
  component: HrMonthRoute,
});

function HrMonthRoute() {
  const { month } = Route.useParams();
  return <HrMonthPage month={month} search={Route.useSearch()} />;
}
