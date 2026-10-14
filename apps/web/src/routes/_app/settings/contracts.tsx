import { createFileRoute, redirect } from '@tanstack/react-router';
import { canReadContractSettings } from '../../../features/retainers/contract-access';
import { ContractSettingsPage } from '../../../features/retainers/contract-settings-page';

export const Route = createFileRoute('/_app/settings/contracts')({
  // Retainer managers with money access see the settings; catalog managers edit them (the API
  // enforces it).
  beforeLoad: ({ context }) => {
    if (!canReadContractSettings(context.me)) throw redirect({ to: '/' });
  },
  component: ContractSettingsPage,
});
