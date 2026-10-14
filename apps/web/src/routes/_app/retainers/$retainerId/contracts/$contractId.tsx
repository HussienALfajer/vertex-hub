import { createFileRoute } from '@tanstack/react-router';
import { ContractPage } from '../../../../../features/retainers/contract-page';

// Contracts need money access (spec F05C, Roles); the API answers 403 or 404 otherwise.
export const Route = createFileRoute('/_app/retainers/$retainerId/contracts/$contractId')({
  component: ContractRoute,
});

function ContractRoute() {
  const { retainerId, contractId } = Route.useParams();
  return <ContractPage key={contractId} retainerId={retainerId} contractId={contractId} />;
}
