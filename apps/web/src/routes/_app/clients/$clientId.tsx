import { createFileRoute } from '@tanstack/react-router';
import {
  ClientProfilePage,
  parseClientProfileSearch,
} from '../../../features/clients/client-profile-page';

export const Route = createFileRoute('/_app/clients/$clientId')({
  validateSearch: parseClientProfileSearch,
  component: ClientProfileRoute,
});

function ClientProfileRoute() {
  const { clientId } = Route.useParams();
  return <ClientProfilePage key={clientId} clientId={clientId} search={Route.useSearch()} />;
}
