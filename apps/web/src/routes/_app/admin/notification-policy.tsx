import { createFileRoute, redirect } from '@tanstack/react-router';
import {
  NotificationPolicyPage,
  parseNotificationPolicySearch,
} from '../../../features/notifications/notification-policy-page';
import { can } from '../../../lib/auth';

export const Route = createFileRoute('/_app/admin/notification-policy')({
  validateSearch: parseNotificationPolicySearch,
  // Hidden from users without notifications.policy; the API refuses them anyway.
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'notifications.policy')) throw redirect({ to: '/' });
  },
  component: NotificationPolicyRoute,
});

function NotificationPolicyRoute() {
  return <NotificationPolicyPage search={Route.useSearch()} />;
}
