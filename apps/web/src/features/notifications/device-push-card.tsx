import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  toast,
} from '@vertex-hub/ui';
import { BellOffIcon, BellRingIcon, SmartphoneIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errors';
import {
  pushConfigQuery,
  pushDeviceQuery,
  useTestPush,
  useTurnOffPush,
  useTurnOnPush,
} from './push.queries';
import { type PushDeviceState, turnedOff } from './push-device';

/** Rule A16: hidden while the server has no keys or the state is still being read. */
export function usePushState(): PushDeviceState | null {
  const config = useQuery(pushConfigQuery);
  const device = useQuery({ ...pushDeviceQuery, enabled: config.data?.available === true });
  if (!config.data?.available) return null;
  return device.data ?? null;
}

/** The device's push actions, shared by the card and the current device's row. */
export function usePushActions() {
  const { t } = useTranslation();
  const turnOn = useTurnOnPush();
  const turnOff = useTurnOffPush();
  const test = useTestPush();
  const onError = (error: Error) => toast.add({ title: errorMessage(t, error), type: 'error' });
  return {
    pending: turnOn.isPending || turnOff.isPending,
    testing: test.isPending,
    turnOn: () =>
      turnOn.mutate(undefined, {
        onError,
        onSuccess: (state) => {
          if (state === 'on') toast.add({ title: t('push.turnedOn'), type: 'success' });
        },
      }),
    turnOff: () =>
      turnOff.mutate(undefined, {
        onError,
        onSuccess: () => toast.add({ title: t('push.turnedOff'), type: 'success' }),
      }),
    test: () =>
      test.mutate(undefined, {
        onError,
        onSuccess: () => toast.add({ title: t('push.testSent'), type: 'success' }),
      }),
  };
}

/**
 * Screen 2: "Turn on notifications on this device", in the notification settings with every
 * state (on, off, blocked, not supported) and on the home page while it is off (rule A7).
 */
export function DevicePushCard({ placement }: { placement: 'home' | 'settings' }) {
  const { t } = useTranslation();
  const state = usePushState();
  const actions = usePushActions();
  if (!state) return null;
  // The home page only invites; a device the user turned off is left alone.
  if (placement === 'home' && (state !== 'off' || turnedOff())) return null;

  if (placement === 'home') {
    return (
      <Callout
        tone="info"
        icon={<BellRingIcon />}
        title={t('push.card.offTitle')}
        description={t('push.card.offBody')}
        action={
          <Button size="sm" disabled={actions.pending} onClick={actions.turnOn}>
            {t('push.turnOn')}
          </Button>
        }
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <SmartphoneIcon className="size-5 text-muted-foreground" aria-hidden="true" />
          {t('push.card.title')}
        </CardTitle>
        <CardDescription className="text-sm">{t('push.card.hint')}</CardDescription>
      </CardHeader>
      <PushStateBody state={state} actions={actions} />
    </Card>
  );
}

function PushStateBody({
  state,
  actions,
}: {
  state: PushDeviceState;
  actions: ReturnType<typeof usePushActions>;
}) {
  const { t } = useTranslation();
  const row = (text: ReactNode, buttons?: ReactNode) => (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm">{text}</p>
      {buttons && <div className="flex flex-wrap gap-2">{buttons}</div>}
    </div>
  );
  switch (state) {
    case 'on':
      return row(
        t('push.state.on'),
        <>
          <Button variant="outline" size="sm" disabled={actions.testing} onClick={actions.test}>
            {t('push.test')}
          </Button>
          <Button variant="outline" size="sm" disabled={actions.pending} onClick={actions.turnOff}>
            {t('push.turnOff')}
          </Button>
        </>,
      );
    case 'off':
      return row(
        t('push.state.off'),
        <Button size="sm" disabled={actions.pending} onClick={actions.turnOn}>
          {t('push.turnOn')}
        </Button>,
      );
    case 'blocked':
      return <BlockedSteps />;
    case 'install':
      return row(
        t('push.state.install'),
        <Button variant="outline" size="sm" render={<Link to="/install" />}>
          {t('pwa.install.how')}
        </Button>,
      );
    case 'too-old':
      return row(t('push.state.tooOld'));
    case 'unsupported':
      return row(t('push.state.unsupported'));
  }
}

/** Rule A7: a refused permission only changes in the browser's or the phone's settings. */
function BlockedSteps() {
  const { t } = useTranslation();
  return (
    <div className="flex gap-3 rounded-md bg-muted p-3 text-sm">
      <BellOffIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-2">
        <p className="font-medium">{t('push.state.blocked')}</p>
        <ul className="flex list-disc flex-col gap-1 ps-5">
          <li>{t('push.blocked.browser')}</li>
          <li>{t('push.blocked.android')}</li>
          <li>{t('push.blocked.iphone')}</li>
        </ul>
      </div>
    </div>
  );
}
