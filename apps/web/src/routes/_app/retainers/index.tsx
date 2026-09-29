import { createFileRoute } from '@tanstack/react-router';
import { parseRetainersSearch, RetainersPage } from '../../../features/retainers/retainers-page';

export const Route = createFileRoute('/_app/retainers/')({
  validateSearch: parseRetainersSearch,
  component: RetainersRoute,
});

function RetainersRoute() {
  return <RetainersPage search={Route.useSearch()} />;
}
