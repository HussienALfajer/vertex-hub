import { createFileRoute } from '@tanstack/react-router';
import { parseTeamSearch, TeamPage } from '../../../features/users/team-page';

export const Route = createFileRoute('/_app/team/')({
  validateSearch: parseTeamSearch,
  component: TeamRoute,
});

function TeamRoute() {
  return <TeamPage search={Route.useSearch()} />;
}
