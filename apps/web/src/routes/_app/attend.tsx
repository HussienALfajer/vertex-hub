import { createFileRoute } from '@tanstack/react-router';
import { AttendPage } from '../../features/hr/attend-page';

/** The link in the entrance code (`/attend#<code>`, rule C5), opened by a phone's camera. */
export const Route = createFileRoute('/_app/attend')({
  component: AttendPage,
});
