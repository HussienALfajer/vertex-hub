import { createFileRoute } from '@tanstack/react-router';
import { AnnouncementPage } from '../../../../features/announcements/announcement-page';

export const Route = createFileRoute('/_app/announcements/$announcementId/')({
  component: AnnouncementRoute,
});

function AnnouncementRoute() {
  const { announcementId } = Route.useParams();
  return <AnnouncementPage key={announcementId} announcementId={announcementId} />;
}
