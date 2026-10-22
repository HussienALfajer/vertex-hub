import { createFileRoute, redirect } from '@tanstack/react-router';
import { businessDate } from '@vertex-hub/contracts';

/** The HR nav's Month opens on this month's sheet (F17 part D). */
export const Route = createFileRoute('/_app/hr/months/')({
  beforeLoad: () => {
    throw redirect({
      to: '/hr/months/$month',
      params: { month: businessDate().slice(0, 7) },
      replace: true,
    });
  },
});
