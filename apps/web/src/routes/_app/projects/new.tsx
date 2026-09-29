import { createFileRoute, redirect } from '@tanstack/react-router';
import { NewProjectPage, parseNewProjectSearch } from '../../../features/projects/new-project-page';
import { projectCreateScope } from '../../../features/projects/project-access';

export const Route = createFileRoute('/_app/projects/new')({
  validateSearch: parseNewProjectSearch,
  // Only `projects.manage` with scope all or own_clients creates projects; the API enforces it.
  beforeLoad: ({ context }) => {
    if (projectCreateScope(context.me) === null) throw redirect({ to: '/projects' });
  },
  component: NewProjectRoute,
});

function NewProjectRoute() {
  return <NewProjectPage search={Route.useSearch()} />;
}
