import { createFileRoute, redirect } from '@tanstack/react-router';
import {
  HrSettingsPage,
  managesHr,
  parseHrSettingsSearch,
} from '../../../features/hr/hr-settings-page';

export const Route = createFileRoute('/_app/hr/settings')({
  validateSearch: parseHrSettingsSearch,
  // Hidden from users without `hr.manage`; the API refuses them anyway.
  beforeLoad: ({ context }) => {
    if (!managesHr(context.me)) throw redirect({ to: '/' });
  },
  component: HrSettingsRoute,
});

function HrSettingsRoute() {
  return <HrSettingsPage search={Route.useSearch()} />;
}
