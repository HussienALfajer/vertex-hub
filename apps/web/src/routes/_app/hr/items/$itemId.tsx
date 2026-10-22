import { createFileRoute } from '@tanstack/react-router';
import { HrItemPage } from '../../../../features/hr/hr-item-page';

export const Route = createFileRoute('/_app/hr/items/$itemId')({
  component: HrItemRoute,
});

// The employee and `hr.read` holders covering them read it; others get 404 from the API.
function HrItemRoute() {
  const { itemId } = Route.useParams();
  return <HrItemPage key={itemId} id={itemId} />;
}
