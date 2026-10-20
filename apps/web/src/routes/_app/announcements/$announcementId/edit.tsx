import { createFileRoute } from '@tanstack/react-router';
import { EditAnnouncementPage } from '../../../../features/announcements/announcement-editor';

// The API lets only the author change it; others see its page instead.
export const Route = createFileRoute('/_app/announcements/$announcementId/edit')({
  component: EditAnnouncementRoute,
});

function EditAnnouncementRoute() {
  const { announcementId } = Route.useParams();
  return <EditAnnouncementPage key={announcementId} announcementId={announcementId} />;
}
