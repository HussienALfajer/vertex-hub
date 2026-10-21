import { createFileRoute } from '@tanstack/react-router';
import {
  EmployeeFilePage,
  parseEmployeeFileSearch,
} from '../../../../features/hr/employee-file-page';

export const Route = createFileRoute('/_app/hr/people/$userId')({
  validateSearch: parseEmployeeFileSearch,
  component: EmployeeFileRoute,
});

// A file outside the viewer's access answers 404 from the API (rule A2).
function EmployeeFileRoute() {
  const { userId } = Route.useParams();
  return <EmployeeFilePage key={userId} userId={userId} search={Route.useSearch()} />;
}
