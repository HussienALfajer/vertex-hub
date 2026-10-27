import { createFileRoute, redirect } from '@tanstack/react-router';
import { NewPostPage, parseNewPostSearch } from '../../../features/content/new-post-page';
import { can } from '../../../lib/auth';

export const Route = createFileRoute('/_app/content/new')({
  validateSearch: parseNewPostSearch,
  // The API decides which clients the user may post for (edit scope, F08).
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'content.manage')) throw redirect({ to: '/content' });
  },
  component: NewPostRoute,
});

function NewPostRoute() {
  return <NewPostPage search={Route.useSearch()} />;
}
