import { createFileRoute, redirect } from '@tanstack/react-router';

/** Until the dashboards (F15), the start page is the user's own tasks. */
export const Route = createFileRoute('/_app/')({
  beforeLoad: () => {
    throw redirect({ to: '/tasks', replace: true });
  },
});
