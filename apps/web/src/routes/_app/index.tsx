import { createFileRoute } from '@tanstack/react-router';
import { HomePage } from '../../features/dashboard/home-page';

/** The home page: the dashboard sections the user can read (F15 screen 1). */
export const Route = createFileRoute('/_app/')({
  component: HomePage,
});
