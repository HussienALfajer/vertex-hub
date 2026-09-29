import { createFileRoute } from '@tanstack/react-router';
import {
  NotificationsPage,
  parseNotificationsSearch,
} from '../../../features/notifications/notifications-page';

export const Route = createFileRoute('/_app/notifications/')({
  validateSearch: parseNotificationsSearch,
  component: NotificationsRoute,
});

function NotificationsRoute() {
  return <NotificationsPage search={Route.useSearch()} />;
}
