import { createFileRoute, redirect } from '@tanstack/react-router';
import { projectCreateScope } from '../../../features/projects/project-access';
import {
  NewRetainerPage,
  parseNewRetainerSearch,
} from '../../../features/retainers/new-retainer-page';

export const Route = createFileRoute('/_app/retainers/new')({
  validateSearch: parseNewRetainerSearch,
  // Only `projects.manage` with scope all or own_clients creates retainers; the API enforces it.
  beforeLoad: ({ context }) => {
    if (projectCreateScope(context.me) === null) throw redirect({ to: '/retainers' });
  },
  component: NewRetainerRoute,
});

function NewRetainerRoute() {
  return <NewRetainerPage search={Route.useSearch()} />;
}
