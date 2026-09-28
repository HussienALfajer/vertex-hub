import { createFileRoute } from '@tanstack/react-router';
import { UserProfilePage } from '../../../features/users/user-profile-page';

export const Route = createFileRoute('/_app/team/$userId')({
  component: UserProfileRoute,
});

function UserProfileRoute() {
  const { userId } = Route.useParams();
  return <UserProfilePage key={userId} userId={userId} />;
}
