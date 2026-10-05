import { createFileRoute } from '@tanstack/react-router';
import { ForgotPasswordPage } from '../features/account/forgot-password-page';

/** Public: asks for a password reset link by email (F14 email rule 13). */
export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordPage,
});
