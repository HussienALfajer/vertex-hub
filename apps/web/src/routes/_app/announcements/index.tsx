import { createFileRoute } from '@tanstack/react-router';
import {
  AnnouncementsPage,
  parseAnnouncementsSearch,
} from '../../../features/announcements/announcements-page';

export const Route = createFileRoute('/_app/announcements/')({
  validateSearch: parseAnnouncementsSearch,
  component: AnnouncementsRoute,
});

function AnnouncementsRoute() {
  return <AnnouncementsPage search={Route.useSearch()} />;
}
