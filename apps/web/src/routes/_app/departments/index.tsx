import { createFileRoute } from '@tanstack/react-router';
import {
  DepartmentsPage,
  parseDepartmentsSearch,
} from '../../../features/departments/departments-page';

export const Route = createFileRoute('/_app/departments/')({
  validateSearch: parseDepartmentsSearch,
  component: DepartmentsRoute,
});

function DepartmentsRoute() {
  return <DepartmentsPage search={Route.useSearch()} />;
}
