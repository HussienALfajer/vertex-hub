import { createFileRoute } from '@tanstack/react-router';
import { DepartmentsPage } from '../../../features/departments/departments-page';

export const Route = createFileRoute('/_app/departments/')({
  component: DepartmentsPage,
});
