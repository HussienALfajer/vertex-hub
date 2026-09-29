import { createFileRoute } from '@tanstack/react-router';
import { ClientsPage, parseClientsSearch } from '../../../features/clients/clients-page';

export const Route = createFileRoute('/_app/clients/')({
  validateSearch: parseClientsSearch,
  component: ClientsRoute,
});

function ClientsRoute() {
  return <ClientsPage search={Route.useSearch()} />;
}
