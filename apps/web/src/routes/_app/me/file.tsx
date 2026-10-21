import { createFileRoute } from '@tanstack/react-router';
import { EmployeeFilePage, parseEmployeeFileSearch } from '../../../features/hr/employee-file-page';
import { useMe } from '../../../lib/auth';

export const Route = createFileRoute('/_app/me/file')({
  validateSearch: parseEmployeeFileSearch,
  component: MyFileRoute,
});

/** The employee's own file, read-only (rule A2). */
function MyFileRoute() {
  const me = useMe();
  return <EmployeeFilePage userId={me.user.id} search={Route.useSearch()} self />;
}
