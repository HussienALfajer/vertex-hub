import { createFileRoute } from '@tanstack/react-router';
import { parseTaskListSearch, TaskListPage } from '../../../features/tasks/task-list-page';

export const Route = createFileRoute('/_app/tasks/list')({
  validateSearch: parseTaskListSearch,
  component: TaskListRoute,
});

function TaskListRoute() {
  return <TaskListPage search={Route.useSearch()} />;
}
