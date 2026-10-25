import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { ACTIVITY_WINDOW_MS, type SignedInDevice } from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  RadioCard,
  RadioGroup,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import {
  BellIcon,
  InfoIcon,
  LaptopIcon,
  MonitorSmartphoneIcon,
  SmartphoneIcon,
  UsersIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { leaveSession } from '../../lib/auth';
import { formatDateTime, formatNumber, formatRelativeTime, isolateLtr } from '../../lib/format';
import { imageSrc } from '../../lib/images';
import { type ReturnFocus, useReturnFocus } from '../../lib/use-return-focus';
import { usePushActions, usePushState } from '../notifications/device-push-card';
import { pushConfigQuery } from '../notifications/push.queries';
import { placeText } from './device-place';
import {
  devicesKeys,
  devicesQuery,
  useSignOutAllDevices,
  useSignOutDevice,
} from './devices.queries';

const PHONE_SYSTEMS = new Set(['Android', 'iOS']);

const DB_IP_URL = 'https://db-ip.com';

/** F01B: where the account is open now, and signing devices out. */
export function SignedInDevicesCard() {
  const { t } = useTranslation();
  const devices = useQuery(devicesQuery);
  const [target, setTarget] = useState<SignedInDevice | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  // A signed-out device's row is gone: the focus goes to "Sign out of all devices" instead.
  const signOutAllButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useReturnFocus(signOutAllButton);
  const others = devices.data?.items.filter((device) => !device.current).length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <MonitorSmartphoneIcon className="size-5 text-muted-foreground" />
          {t('devices.title')}
        </CardTitle>
        <CardDescription className="text-sm">{t('devices.hint')}</CardDescription>
      </CardHeader>
      {devices.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : devices.isError ? (
        <LoadError message={t('devices.loadError')} onRetry={() => devices.refetch()} />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {devices.data.items.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              onSignOut={(event) => {
                returnFocus.from(event.currentTarget);
                setTarget(device);
              }}
            />
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button
          ref={signOutAllButton}
          variant="outline"
          className="text-destructive-text"
          disabled={!devices.isSuccess}
          onClick={() => setAllOpen(true)}
        >
          {t('devices.signOutAll')}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t('devices.attribution')}{' '}
          <a href={DB_IP_URL} target="_blank" rel="noreferrer" className="underline">
            DB-IP
          </a>
        </p>
      </div>
      <SignOutDeviceDialog
        device={target}
        onClose={() => setTarget(null)}
        returnFocus={returnFocus}
      />
      <SignOutAllDialog open={allOpen} others={others} onClose={() => setAllOpen(false)} />
    </Card>
  );
}

function DeviceIcon({ system }: { system: string }) {
  const Icon = PHONE_SYSTEMS.has(system) ? SmartphoneIcon : LaptopIcon;
  return <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />;
}

/** Rule 16: activity in the last five minutes is "Active now". */
function activityText(t: TFunction, at: string): string {
  return Date.now() - new Date(at).getTime() < ACTIVITY_WINDOW_MS
    ? t('devices.activeNow')
    : t('devices.lastActive', { time: formatRelativeTime(at) });
}

function DeviceRow({
  device,
  onSignOut,
}: {
  device: SignedInDevice;
  onSignOut: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const { t } = useTranslation();
  const { signIn, lastActive } = device;
  const movedOn = lastActive.ip !== null && lastActive.ip !== signIn.ip;
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 gap-3">
          <DeviceIcon system={device.device.system} />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium" dir="auto">
                {device.device.label}
              </span>
              {device.current && <Badge tone="success">{t('devices.thisDevice')}</Badge>}
            </div>
            <span className="text-sm">
              {placeText(t, signIn.location)}
              {signIn.ip && (
                <>
                  {' · '}
                  <span dir="ltr" className="break-all">
                    {signIn.ip}
                  </span>
                </>
              )}
            </span>
            <span className="flex flex-col gap-0.5 text-sm text-muted-foreground sm:flex-row sm:gap-3">
              <span>{t('devices.signedIn', { time: formatDateTime(signIn.at) })}</span>
              <span>{activityText(t, lastActive.at)}</span>
            </span>
            {movedOn && (
              <span className="text-sm text-muted-foreground">
                {t('devices.from')}{' '}
                <span dir="ltr" className="break-all">
                  {lastActive.ip}
                </span>
                {' · '}
                {placeText(t, lastActive.location)}
              </span>
            )}
          </div>
        </div>
        {!device.current && (
          <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={onSignOut}>
            {t('devices.signOut')}
          </Button>
        )}
      </div>
      <DevicePush device={device} />
      {device.sharedWith.length > 0 && <SharedWith device={device} />}
    </li>
  );
}

/**
 * F16 rule A12: whether the device gets notifications and the last one delivered. This device
 * reads its own state from the browser and offers the test and the switch.
 */
function DevicePush({ device }: { device: SignedInDevice }) {
  const { t } = useTranslation();
  const config = useQuery(pushConfigQuery);
  const local = usePushState();
  const actions = usePushActions();
  // Rule A16: without the server's keys there is no push to speak of.
  if (!config.data?.available) return null;
  const state = device.current && local ? local : device.push.state;
  const label =
    state === 'on'
      ? t('push.row.on')
      : state === 'unsupported' || state === 'too-old' || state === 'install'
        ? t('push.row.unsupported')
        : state === 'blocked'
          ? t('push.row.blocked')
          : t('push.row.off');
  return (
    <div className="flex flex-col gap-2 ps-8 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <BellIcon aria-hidden="true" className="size-4 shrink-0" />
        {label}
        {state === 'on' && device.push.lastDeliveredAt && (
          <>
            {' · '}
            {t('push.row.lastDelivered', { time: formatRelativeTime(device.push.lastDeliveredAt) })}
          </>
        )}
      </span>
      {device.current && local === 'on' && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={actions.testing} onClick={actions.test}>
            {t('push.test')}
          </Button>
          <Button variant="outline" size="sm" disabled={actions.pending} onClick={actions.turnOff}>
            {t('push.turnOff')}
          </Button>
        </div>
      )}
      {device.current && local === 'off' && (
        <Button
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          disabled={actions.pending}
          onClick={actions.turnOn}
        >
          {t('push.turnOn')}
        </Button>
      )}
    </div>
  );
}

/** Rule 15: colleagues signed in on the same device, one per line. */
function SharedWith({ device }: { device: SignedInDevice }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-3 rounded-md bg-muted p-3 text-sm">
      <UsersIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-muted-foreground">{t('devices.shared.title')}</span>
        <ul className="flex flex-col gap-2">
          {device.sharedWith.map((shared) => (
            <li key={shared.user.id} className="flex items-start gap-2">
              <Avatar name={shared.user.name} src={imageSrc(shared.user.imageId, 'sm')} size="sm" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-start gap-1.5">
                  <span>
                    <strong className="font-medium">{shared.user.name}</strong>
                    {shared.department && ` (${shared.department.name})`}
                    {'، '}
                    {shared.match === 'same_browser'
                      ? t('devices.shared.sameBrowser')
                      : t('devices.shared.sameDevice')}
                  </span>
                  {shared.match === 'same_device' && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            aria-label={t('devices.shared.probablyHint')}
                            className="mt-0.5 inline-flex shrink-0 rounded-full text-muted-foreground"
                          />
                        }
                      >
                        <InfoIcon className="size-4" />
                      </TooltipTrigger>
                      <TooltipContent>{t('devices.shared.probablyHint')}</TooltipContent>
                    </Tooltip>
                  )}
                </span>
                <span className="text-muted-foreground">
                  {activityText(t, shared.lastActiveAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Rule 9: one of the user's other devices. */
function SignOutDeviceDialog({
  device,
  onClose,
  returnFocus,
}: {
  device: SignedInDevice | null;
  onClose: () => void;
  returnFocus: ReturnFocus;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const signOut = useSignOutDevice();
  // The content stays as it was while the dialog fades out.
  const [shown, setShown] = useState(device);
  if (device && device !== shown) setShown(device);

  return (
    <ConfirmDialog
      open={device !== null}
      onClose={onClose}
      finalFocus={returnFocus.target}
      title={t('devices.signOutOne.title', { device: shown?.device.label ?? '' })}
      body={
        shown
          ? t('devices.signOutOne.body', {
              place: placeText(t, shown.signIn.location),
              ip: shown.signIn.ip ? isolateLtr(shown.signIn.ip) : t('devices.unknownIp'),
              activity: activityText(t, shown.lastActive.at),
            })
          : ''
      }
      action={t('devices.signOut')}
      destructive
      pending={signOut.isPending}
      onConfirm={async () => {
        if (!shown || signOut.isPending) return;
        try {
          await signOut.mutateAsync(shown.id);
          toast.add({ title: t('devices.signOutOne.done'), type: 'success' });
        } catch (error) {
          // Edge case 3: signed out meanwhile, from another tab or device.
          if (error instanceof ApiError && error.status === 404) {
            void queryClient.invalidateQueries({ queryKey: devicesKeys.all });
            toast.add({ title: t('devices.signOutOne.gone'), type: 'info' });
            return;
          }
          throw error;
        }
      }}
    />
  );
}

type Reach = 'others' | 'all';

/** Rules 10 and 11: every other device, or every device with this one. */
function SignOutAllDialog({
  open,
  others,
  onClose,
}: {
  open: boolean;
  others: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOutAll = useSignOutAllDevices();
  const [reach, setReach] = useState<Reach>('others');
  // Every opening starts on the default, "all devices except this one".
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setReach('others');
  }
  const chosen: Reach = others === 0 ? 'all' : reach;

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t('devices.signOutAllDialog.title')}
      body={t('devices.signOutAllDialog.body', { count: others, n: formatNumber(others) })}
      action={t('devices.signOut')}
      destructive
      pending={signOutAll.isPending}
      onConfirm={async () => {
        if (signOutAll.isPending) return;
        const includeCurrent = chosen === 'all';
        await signOutAll.mutateAsync(includeCurrent);
        if (includeCurrent) {
          await leaveSession(queryClient, () =>
            router.navigate({ to: '/login', search: { signedOut: 'all' } }),
          );
          return;
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: devicesKeys.all }),
          queryClient.invalidateQueries({ queryKey: ['audit'] }),
        ]);
        toast.add({ title: t('devices.signOutAllDialog.done'), type: 'success' });
      }}
    >
      <RadioGroup<Reach>
        aria-label={t('devices.signOutAllDialog.reach')}
        value={chosen}
        onValueChange={setReach}
      >
        <RadioCard
          value="others"
          disabled={others === 0}
          title={t('devices.signOutAllDialog.others')}
          description={others === 0 ? t('devices.signOutAllDialog.noOthers') : undefined}
        />
        <RadioCard
          value="all"
          title={t('devices.signOutAllDialog.all')}
          description={t('devices.signOutAllDialog.allHint')}
        />
      </RadioGroup>
    </ConfirmDialog>
  );
}
