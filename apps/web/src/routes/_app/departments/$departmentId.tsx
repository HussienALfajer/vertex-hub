import { createFileRoute } from '@tanstack/react-router';
import {
  DepartmentPage,
  parseDepartmentPageSearch,
} from '../../../features/departments/department-page';

export const Route = createFileRoute('/_app/departments/$departmentId')({
  validateSearch: parseDepartmentPageSearch,
  component: DepartmentRoute,
});

function DepartmentRoute() {
  const { departmentId } = Route.useParams();
  return (
    <DepartmentPage key={departmentId} departmentId={departmentId} search={Route.useSearch()} />
  );
}
