import { createFileRoute } from '@tanstack/react-router';
import { ShootPage } from '../../../../features/calendar/shoot-page';

export const Route = createFileRoute('/_app/shoots/$shootId/')({
  component: ShootRoute,
});

function ShootRoute() {
  const { shootId } = Route.useParams();
  return <ShootPage key={shootId} shootId={shootId} />;
}
