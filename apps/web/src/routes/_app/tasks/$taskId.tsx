import { createFileRoute } from '@tanstack/react-router';
import { TaskPage } from '../../../features/tasks/task-page';

export const Route = createFileRoute('/_app/tasks/$taskId')({
  component: TaskRoute,
});

function TaskRoute() {
  const { taskId } = Route.useParams();
  return <TaskPage key={taskId} taskId={taskId} />;
}
