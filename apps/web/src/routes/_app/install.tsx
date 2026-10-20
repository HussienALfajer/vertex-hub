import { createFileRoute } from '@tanstack/react-router';
import { InstallPage } from '../../features/app/install-page';

/** F16 screen 1: the install guide, this device's steps first. */
export const Route = createFileRoute('/_app/install')({
  component: InstallPage,
});
