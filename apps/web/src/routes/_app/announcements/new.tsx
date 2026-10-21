import { createFileRoute } from '@tanstack/react-router';
import { NewAnnouncementPage } from '../../../features/announcements/announcement-editor';

// Every active user writes announcements (spec F16, "Roles and access").
export const Route = createFileRoute('/_app/announcements/new')({
  component: NewAnnouncementPage,
});
