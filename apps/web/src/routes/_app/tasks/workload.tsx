import { createFileRoute } from '@tanstack/react-router';
import {
  parseTaskWorkloadSearch,
  TaskWorkloadPage,
} from '../../../features/tasks/task-workload-page';

export const Route = createFileRoute('/_app/tasks/workload')({
  validateSearch: parseTaskWorkloadSearch,
  component: TaskWorkloadRoute,
});

function TaskWorkloadRoute() {
  return <TaskWorkloadPage search={Route.useSearch()} />;
}
