import { createFileRoute, redirect } from '@tanstack/react-router';
import { EditShootPage } from '../../../../features/calendar/shoot-form-pages';
import { can } from '../../../../lib/auth';

export const Route = createFileRoute('/_app/shoots/$shootId/edit')({
  // Hidden from users without shoots.manage; the API refuses them anyway.
  beforeLoad: ({ context, params }) => {
    if (!can(context.me, 'shoots.manage'))
      throw redirect({ to: '/shoots/$shootId', params: { shootId: params.shootId } });
  },
  component: EditShootRoute,
});

function EditShootRoute() {
  const { shootId } = Route.useParams();
  return <EditShootPage key={shootId} shootId={shootId} />;
}
