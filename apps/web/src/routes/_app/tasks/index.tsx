import { createFileRoute } from '@tanstack/react-router';
import { MyTasksPage } from '../../../features/tasks/my-tasks-page';

export const Route = createFileRoute('/_app/tasks/')({
  component: MyTasksPage,
});
