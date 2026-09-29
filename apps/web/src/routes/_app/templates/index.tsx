import { createFileRoute } from '@tanstack/react-router';
import { parseTemplatesSearch, TemplatesPage } from '../../../features/templates/templates-page';

export const Route = createFileRoute('/_app/templates/')({
  validateSearch: parseTemplatesSearch,
  component: TemplatesRoute,
});

function TemplatesRoute() {
  return <TemplatesPage search={Route.useSearch()} />;
}
