import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  NOTIFICATION_CATEGORIES,
  type NotificationSettings,
  type NotificationType,
} from '@vertex-hub/contracts';
import {
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
import { notificationSettingsQuery, useUpdateNotificationSettings } from './notifications.queries';

/** Mute the types that need no action, grouped by category (F14 screen 3, rule 3). */
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
        <SettingsForm settings={settings.data} />
      )}
    </>
  );
}

function SettingsForm({ settings }: { settings: NotificationSettings }) {
  const { t } = useTranslation();
  const update = useUpdateNotificationSettings();
  // Shows the change at once; a failed save falls back to the stored settings.
  const muted = new Set<NotificationType>(
    update.isPending
      ? update.variables.mutedTypes
      : settings.types.filter((item) => item.muted).map((item) => item.type),
  );

  function toggle(type: NotificationType, notify: boolean) {
    const next = new Set(muted);
    if (notify) next.delete(type);
    else next.add(type);
    update.mutate(
      { mutedTypes: [...next] },
      {
        onSuccess: () => toast.add({ title: t('notifications.settings.saved'), type: 'success' }),
        onError: (error) => toast.add({ title: errorMessage(t, error), type: 'error' }),
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {NOTIFICATION_CATEGORIES.map((category) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle>{t(`notifications.categories.${category}`)}</CardTitle>
          </CardHeader>
          <ul className="flex flex-col divide-y divide-border">
            {settings.types
              .filter((item) => item.category === category)
              .map((item) => {
                const name = t(`notifications.types.${item.type}`);
                const id = `notify-${item.type}`;
                return (
                  <li key={item.type} className="flex items-center justify-between gap-4 py-3">
                    <label htmlFor={id} className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{name}</span>
                      {!item.mutable && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <LockIcon className="size-3" aria-hidden="true" />
                          {t('notifications.settings.locked')}
                        </span>
                      )}
                    </label>
                    <Switch
                      id={id}
                      checked={!item.mutable || !muted.has(item.type)}
                      disabled={!item.mutable || update.isPending}
                      onCheckedChange={(checked) => toggle(item.type, checked)}
                    />
                  </li>
                );
              })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
