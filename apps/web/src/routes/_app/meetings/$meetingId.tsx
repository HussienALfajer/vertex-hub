import { createFileRoute } from '@tanstack/react-router';
import { MeetingPage } from '../../../features/calendar/meeting-page';

export const Route = createFileRoute('/_app/meetings/$meetingId')({
  component: MeetingRoute,
});

function MeetingRoute() {
  const { meetingId } = Route.useParams();
  return <MeetingPage key={meetingId} meetingId={meetingId} />;
}
