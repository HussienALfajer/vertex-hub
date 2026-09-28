import { createFileRoute } from '@tanstack/react-router';
import { DepartmentPage } from '../../../features/departments/department-page';

export const Route = createFileRoute('/_app/departments/$departmentId')({
  component: DepartmentRoute,
});

function DepartmentRoute() {
  const { departmentId } = Route.useParams();
  return <DepartmentPage key={departmentId} departmentId={departmentId} />;
}
