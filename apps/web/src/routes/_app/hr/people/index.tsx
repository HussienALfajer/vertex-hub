import { createFileRoute, redirect } from '@tanstack/react-router';
import {
  hasPeopleAccess,
  PeoplePage,
  parsePeopleSearch,
} from '../../../../features/hr/people-page';

export const Route = createFileRoute('/_app/hr/people/')({
  validateSearch: parsePeopleSearch,
  // Hidden from users who read neither files nor pay; the API refuses them anyway.
  beforeLoad: ({ context }) => {
    if (!hasPeopleAccess(context.me)) throw redirect({ to: '/' });
  },
  component: PeopleRoute,
});

function PeopleRoute() {
  return <PeoplePage search={Route.useSearch()} />;
}
