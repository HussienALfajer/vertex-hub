import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type ChannelMode,
  NOTIFICATION_CATEGORIES,
  type NotificationPriority,
  type NotificationSettings,
  type NotificationType,
  type UpdateNotificationSettings,
} from '@vertex-hub/contracts';
import {
  Badge,
  type BadgeProps,
  Button,
  Card,
  CardHeader,
  CardTitle,
  PageHeader,
  Skeleton,
  Switch,
  toast,
} from '@vertex-hub/ui';
import { ArrowRightIcon, LockIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { DevicePushCard } from './device-push-card';
import { notificationSettingsQuery, useUpdateNotificationSettings } from './notifications.queries';
import { pushConfigQuery } from './push.queries';

/**
 * Mute the types that need no action, grouped by category (F14 screen 3, rule 3), and choose the
 * types pushed (F16 screen 5, rule A7) and emailed, the morning digest (F14 email screen 1,
 * rules 2 and 11) and the morning push (F16 rule B14). Management's policy locks a channel on
 * (`required`) or hides it (`unavailable`). Each category turns a channel on or off at once.
 */
export function NotificationSettingsPage() {
  const { t } = useTranslation();
  const settings = useQuery(notificationSettingsQuery);
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/notifications" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('notifications.settings.back')}
        </Button>
      </div>
      <PageHeader
        title={t('notifications.settings.title')}
        description={t('notifications.settings.subtitle')}
      />
      {settings.isPending ? (
        <div className="flex flex-col gap-6">
          {['a', 'b', 'c'].map((card) => (
            <Skeleton key={card} className="h-48 w-full rounded-lg" />
          ))}
        </div>
      ) : settings.isError ? (
        <LoadError
          message={t('notifications.settings.loadError')}
          onRetry={() => settings.refetch()}
        />
      ) : (
        <>
          <DevicePushCard placement="settings" />
          <SettingsForm settings={settings.data} />
        </>
      )}
    </>
  );
}

/** The set with `types` added or removed. */
function toggled(
  set: Set<NotificationType>,
  types: NotificationType | NotificationType[],
  on: boolean,
) {
  const next = new Set(set);
  for (const type of Array.isArray(types) ? types : [types]) {
    if (on) next.add(type);
    else next.delete(type);
  }
  return [...next];
}

type SettingsChannel = 'app' | 'push' | 'email';

/** A channel's switch the user may change: not locked by the type or the policy, nor muted away. */
function userChoice(mode: ChannelMode, inApp: boolean) {
  return inApp && mode !== 'required' && mode !== 'unavailable';
}

export const PRIORITY_TONES: Record<NotificationPriority, BadgeProps['tone']> = {
  critical: 'danger',
  important: 'warning',
  normal: 'neutral',
  informational: 'outline',
};

/** A channel's switch under the policy: hidden when unavailable, locked on when required. */
function ChannelSwitch({
  mode,
  label,
  checked,
  disabled,
  onChange,
}: {
  mode: ChannelMode;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  // An empty cell keeps the column lined up.
  if (mode === 'unavailable') return <span className="w-10" />;
  return (
    <span className="flex w-10 justify-center">
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled || mode === 'required'}
        onCheckedChange={onChange}
      />
    </span>
  );
}

function SettingsForm({ settings }: { settings: NotificationSettings }) {
  const { t } = useTranslation();
  const update = useUpdateNotificationSettings();
  // Rule A16: without the server's keys, there is no push column.
  const pushAvailable = useQuery(pushConfigQuery).data?.available === true;
  // Shows the change at once; a failed save falls back to the stored settings.
  const pending = update.isPending ? update.variables : undefined;
  const muted = new Set<NotificationType>(
    pending?.mutedTypes ?? settings.types.filter((item) => item.muted).map((item) => item.type),
  );
  const emailed = new Set<NotificationType>(
    pending?.emailTypes ?? settings.types.filter((item) => item.email).map((item) => item.type),
  );
  const pushed = new Set<NotificationType>(
    pending?.pushTypes ?? settings.types.filter((item) => item.push).map((item) => item.type),
  );
  const digestEnabled = pending?.digestEnabled ?? settings.digestEnabled;
  const morningPush = pending?.morningPush ?? settings.morningPush;
  // Every channel save sends both lists, so neither falls back to what the server held before.
  const channels = { pushTypes: [...pushed], emailTypes: [...emailed] };

  function save(input: UpdateNotificationSettings) {
    update.mutate(input, {
      onSuccess: () => toast.add({ title: t('notifications.settings.saved'), type: 'success' }),
      onError: (error) => toast.add({ title: errorMessage(t, error), type: 'error' }),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="digest" className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{t('notifications.settings.digest')}</span>
            <span className="text-xs text-muted-foreground">
              {t('notifications.settings.digestHint')}
            </span>
          </label>
          <Switch
            id="digest"
            checked={digestEnabled}
            disabled={update.isPending}
            onCheckedChange={(checked) => save({ mutedTypes: [...muted], digestEnabled: checked })}
          />
        </div>
        {pushAvailable && (
          <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
            <label htmlFor="morning-push" className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{t('notifications.settings.morningPush')}</span>
              <span className="text-xs text-muted-foreground">
                {t('notifications.settings.morningPushHint')}
              </span>
            </label>
            <Switch
              id="morning-push"
              checked={morningPush}
              disabled={update.isPending}
              onCheckedChange={(checked) => save({ mutedTypes: [...muted], morningPush: checked })}
            />
          </div>
        )}
      </Card>
      {NOTIFICATION_CATEGORIES.map((category) => {
        const items = settings.types.filter((item) => item.category === category);
        const categoryName = t(`notifications.categories.${category}`);
        const inAppOf = (item: (typeof items)[number]) => !(item.mutable && muted.has(item.type));
        // "Turn all on or off" (screen 5): the types whose switch the user may change.
        const choices: Record<SettingsChannel, { types: NotificationType[]; on: boolean }> = {
          app: choice(
            items.filter((item) => item.mutable),
            (item) => !muted.has(item.type),
          ),
          push: choice(
            items.filter((item) => userChoice(item.pushMode, inAppOf(item))),
            (item) => pushed.has(item.type),
          ),
          email: choice(
            items.filter((item) => userChoice(item.emailMode, inAppOf(item))),
            (item) => emailed.has(item.type),
          ),
        };
        function setAll(channel: SettingsChannel, on: boolean) {
          const { types } = choices[channel];
          if (channel === 'app') save({ mutedTypes: toggled(muted, types, !on) });
          else
            save({
              mutedTypes: [...muted],
              ...channels,
              [channel === 'push' ? 'pushTypes' : 'emailTypes']: toggled(
                channel === 'push' ? pushed : emailed,
                types,
                on,
              ),
            });
        }
        const columns: SettingsChannel[] = pushAvailable
          ? ['app', 'push', 'email']
          : ['app', 'email'];
        return (
          <Card key={category}>
            <CardHeader className="flex-row items-center justify-between gap-4">
              <CardTitle>{categoryName}</CardTitle>
              <div className="flex gap-4 text-xs font-medium text-muted-foreground">
                {columns.map((channel) => (
                  <span key={channel} className="flex w-10 flex-col items-center gap-1">
                    <span aria-hidden="true">{t(`notifications.settings.${channel}`)}</span>
                    <Switch
                      aria-label={t('notifications.settings.allLabel', {
                        channel: t(`notifications.settings.${channel}`),
                        category: categoryName,
                      })}
                      checked={choices[channel].on}
                      disabled={choices[channel].types.length === 0 || update.isPending}
                      onCheckedChange={(checked) => setAll(channel, checked)}
                    />
                  </span>
                ))}
              </div>
            </CardHeader>
            <ul className="flex flex-col divide-y divide-border">
              {items.map((item) => {
                const name = t(`notifications.types.${item.type}`);
                const inApp = !(item.mutable && muted.has(item.type));
                return (
                  <li key={item.type} className="flex items-center justify-between gap-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {name}
                        <Badge tone={PRIORITY_TONES[item.priority]}>
                          {t(`notifications.priorities.${item.priority}`)}
                        </Badge>
                      </span>
                      {!item.mutable && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <LockIcon className="size-3" aria-hidden="true" />
                          {t('notifications.settings.locked')}
                        </span>
                      )}
                      {((pushAvailable && item.pushMode === 'required') ||
                        item.emailMode === 'required') && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <LockIcon className="size-3" aria-hidden="true" />
                          {t('notifications.settings.required')}
                        </span>
                      )}
                      {!inApp && (
                        <span className="text-xs text-muted-foreground">
                          {t('notifications.settings.emailLocked')}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-4">
                      <Switch
                        aria-label={t('notifications.settings.appLabel', { name })}
                        checked={inApp}
                        disabled={!item.mutable || update.isPending}
                        onCheckedChange={(checked) =>
                          save({ mutedTypes: toggled(muted, item.type, !checked) })
                        }
                      />
                      {pushAvailable && (
                        <ChannelSwitch
                          mode={item.pushMode}
                          label={t('notifications.settings.pushLabel', { name })}
                          // A type muted in the app creates nothing to push.
                          checked={inApp && pushed.has(item.type)}
                          disabled={!inApp || update.isPending}
                          onChange={(checked) =>
                            save({
                              mutedTypes: [...muted],
                              ...channels,
                              pushTypes: toggled(pushed, item.type, checked),
                            })
                          }
                        />
                      )}
                      <ChannelSwitch
                        mode={item.emailMode}
                        label={t('notifications.settings.emailLabel', { name })}
                        // A type muted in the app creates nothing to email (rule 2).
                        checked={inApp && emailed.has(item.type)}
                        disabled={!inApp || update.isPending}
                        onChange={(checked) =>
                          save({
                            mutedTypes: [...muted],
                            ...channels,
                            emailTypes: toggled(emailed, item.type, checked),
                          })
                        }
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

/** The types a category's switch covers, and whether all of them are on. */
function choice<Item extends { type: NotificationType }>(
  items: Item[],
  isOn: (item: Item) => boolean,
) {
  return { types: items.map((item) => item.type), on: items.length > 0 && items.every(isOn) };
}
