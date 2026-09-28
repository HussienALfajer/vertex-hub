import { createFileRoute } from '@tanstack/react-router';
import { ActivatePage } from '../features/account/activate-page';

/** Public: opened from an activation or reset link (`/activate#token=…`). */
export const Route = createFileRoute('/activate')({
  component: ActivatePage,
});
