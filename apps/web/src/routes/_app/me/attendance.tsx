import { createFileRoute } from '@tanstack/react-router';
import { MyAttendancePage, parseMyAttendanceSearch } from '../../../features/hr/my-attendance-page';

export const Route = createFileRoute('/_app/me/attendance')({
  validateSearch: parseMyAttendanceSearch,
  component: MyAttendanceRoute,
});

function MyAttendanceRoute() {
  return <MyAttendancePage search={Route.useSearch()} />;
}
