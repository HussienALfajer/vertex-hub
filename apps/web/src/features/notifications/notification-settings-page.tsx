import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  NOTIFICATION_CATEGORIES,
  type NotificationSettings,
  type NotificationType,
  type UpdateNotificationSettings,
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

/**
 * Mute the types that need no action, grouped by category (F14 screen 3, rule 3), and choose the
 * types emailed and the morning digest (F14 email screen 1, rules 2 and 11).
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
        <SettingsForm settings={settings.data} />
      )}
    </>
  );
}

/** The set with `type` added or removed. */
function toggled(set: Set<NotificationType>, type: NotificationType, on: boolean) {
  const next = new Set(set);
  if (on) next.add(type);
  else next.delete(type);
  return [...next];
}

function SettingsForm({ settings }: { settings: NotificationSettings }) {
  const { t } = useTranslation();
  const update = useUpdateNotificationSettings();
  // Shows the change at once; a failed save falls back to the stored settings.
  const pending = update.isPending ? update.variables : undefined;
  const muted = new Set<NotificationType>(
    pending?.mutedTypes ?? settings.types.filter((item) => item.muted).map((item) => item.type),
  );
  const emailed = new Set<NotificationType>(
    pending?.emailTypes ?? settings.types.filter((item) => item.email).map((item) => item.type),
  );
  const digestEnabled = pending?.digestEnabled ?? settings.digestEnabled;

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
      </Card>
      {NOTIFICATION_CATEGORIES.map((category) => (
        <Card key={category}>
          <CardHeader className="flex-row items-center justify-between gap-4">
            <CardTitle>{t(`notifications.categories.${category}`)}</CardTitle>
            <div
              aria-hidden="true"
              className="flex gap-4 text-xs font-medium text-muted-foreground"
            >
              <span className="w-10 text-center">{t('notifications.settings.app')}</span>
              <span className="w-10 text-center">{t('notifications.settings.email')}</span>
            </div>
          </CardHeader>
          <ul className="flex flex-col divide-y divide-border">
            {settings.types
              .filter((item) => item.category === category)
              .map((item) => {
                const name = t(`notifications.types.${item.type}`);
                // A type muted in the app creates nothing to email (rule 2).
                const emailLocked = item.mutable && muted.has(item.type);
                return (
                  <li key={item.type} className="flex items-center justify-between gap-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{name}</span>
                      {!item.mutable && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <LockIcon className="size-3" aria-hidden="true" />
                          {t('notifications.settings.locked')}
                        </span>
                      )}
                      {emailLocked && (
                        <span className="text-xs text-muted-foreground">
                          {t('notifications.settings.emailLocked')}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-4">
                      <Switch
                        aria-label={t('notifications.settings.appLabel', { name })}
                        checked={!emailLocked}
                        disabled={!item.mutable || update.isPending}
                        onCheckedChange={(checked) =>
                          save({ mutedTypes: toggled(muted, item.type, !checked) })
                        }
                      />
                      <Switch
                        aria-label={t('notifications.settings.emailLabel', { name })}
                        checked={!emailLocked && emailed.has(item.type)}
                        disabled={emailLocked || update.isPending}
                        onCheckedChange={(checked) =>
                          save({
                            mutedTypes: [...muted],
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
      ))}
    </div>
  );
}
