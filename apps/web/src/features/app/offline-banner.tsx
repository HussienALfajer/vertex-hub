import { useQueryClient } from '@tanstack/react-query';
import { Callout } from '@vertex-hub/ui';
import { WifiOffIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../lib/format';
import { useOnline } from '../../lib/use-online';

/**
 * F16 rule A5: offline, the app shows the last data it loaded and says when that was. Actions
 * that change data are disabled by the shell (`AppShell`), as the hint says.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const online = useOnline();
  const queryClient = useQueryClient();
  if (online) return null;
  const updatedAt = Math.max(
    0,
    ...queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state.dataUpdatedAt),
  );
  return (
    <Callout
      tone="warning"
      role="status"
      icon={<WifiOffIcon />}
      title={
        updatedAt > 0
          ? t('pwa.offline.titleUpdated', {
              time: formatDateTime(new Date(updatedAt).toISOString()),
            })
          : t('pwa.offline.title')
      }
      description={t('pwa.offline.hint')}
    />
  );
}
