import { createFileRoute } from '@tanstack/react-router';
import { NotificationSettingsPage } from '../../../features/notifications/notification-settings-page';

export const Route = createFileRoute('/_app/notifications/settings')({
  component: NotificationSettingsPage,
});
