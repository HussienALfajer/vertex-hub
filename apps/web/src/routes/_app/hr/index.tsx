import { createFileRoute, redirect } from '@tanstack/react-router';
import { readsHr } from '../../../features/hr/hr-approvals-page';
import { managesHr } from '../../../features/hr/hr-settings-page';
import { hasPeopleAccess } from '../../../features/hr/people-page';

/** The HR section opens on its first page the user can use (F17). */
export const Route = createFileRoute('/_app/hr/')({
  beforeLoad: ({ context }) => {
    if (hasPeopleAccess(context.me)) throw redirect({ to: '/hr/people', replace: true });
    if (readsHr(context.me)) throw redirect({ to: '/hr/approvals', replace: true });
    if (managesHr(context.me)) throw redirect({ to: '/hr/settings', replace: true });
    throw redirect({ to: '/', replace: true });
  },
});
