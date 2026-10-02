import { createFileRoute, redirect } from '@tanstack/react-router';
import { NewShootPage, parseNewShootSearch } from '../../../features/calendar/shoot-form-pages';
import { can } from '../../../lib/auth';

export const Route = createFileRoute('/_app/shoots/new')({
  validateSearch: parseNewShootSearch,
  // Hidden from users without shoots.manage; the API refuses them anyway.
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'shoots.manage')) throw redirect({ to: '/calendar' });
  },
  component: NewShootRoute,
});

function NewShootRoute() {
  const search = Route.useSearch();
  return <NewShootPage key={search.taskId} search={search} />;
}
