import { createFileRoute, redirect } from '@tanstack/react-router';
import { NewTemplatePage } from '../../../features/templates/new-template-page';
import { can } from '../../../lib/auth';

export const Route = createFileRoute('/_app/templates/new')({
  // Hidden from users who cannot manage templates; the API refuses them anyway.
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'templates.manage')) throw redirect({ to: '/templates' });
  },
  component: NewTemplatePage,
});
