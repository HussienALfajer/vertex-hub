import { createFileRoute } from '@tanstack/react-router';
import { KioskPage } from '../features/hr/kiosk-page';

/** Public: the entrance screen (spec F17, rule C4), outside the app shell, with no session. */
export const Route = createFileRoute('/kiosk')({
  component: KioskPage,
});
