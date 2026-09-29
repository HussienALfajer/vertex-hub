import { createFileRoute } from '@tanstack/react-router';
import { parseRetainerPageSearch, RetainerPage } from '../../../features/retainers/retainer-page';

export const Route = createFileRoute('/_app/retainers/$retainerId')({
  validateSearch: parseRetainerPageSearch,
  component: RetainerRoute,
});

function RetainerRoute() {
  const { retainerId } = Route.useParams();
  return <RetainerPage key={retainerId} retainerId={retainerId} search={Route.useSearch()} />;
}
