import { createFileRoute } from '@tanstack/react-router';
import { parseTaskBoardSearch, TaskBoardPage } from '../../../features/tasks/task-board-page';

export const Route = createFileRoute('/_app/tasks/board')({
  validateSearch: parseTaskBoardSearch,
  component: TaskBoardRoute,
});

function TaskBoardRoute() {
  return <TaskBoardPage search={Route.useSearch()} />;
}
