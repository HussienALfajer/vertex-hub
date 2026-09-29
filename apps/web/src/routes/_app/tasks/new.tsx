import { createFileRoute, redirect } from '@tanstack/react-router';
import { NewTaskPage, parseNewTaskSearch } from '../../../features/tasks/new-task-page';
import { can } from '../../../lib/auth';

export const Route = createFileRoute('/_app/tasks/new')({
  validateSearch: parseNewTaskSearch,
  // Every active user holds `tasks.request`; the API enforces who may assign whom.
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'tasks.request')) throw redirect({ to: '/tasks' });
  },
  component: NewTaskRoute,
});

function NewTaskRoute() {
  return <NewTaskPage search={Route.useSearch()} />;
}
