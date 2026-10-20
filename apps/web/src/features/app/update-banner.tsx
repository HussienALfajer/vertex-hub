import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button, Callout } from '@vertex-hub/ui';
import { RefreshCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** A deployed version is noticed while the app stays open. */
const UPDATE_CHECK_MS = 30 * 60 * 1000;
let checking = false;

/**
 * Registers the service worker (F16 rule A2) and, when a new version waits, says so (rule A6).
 * "Refresh" lets it take over and reloads; an app opened fresh already runs the new version.
 */
export function UpdateBanner() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_url, registration) => {
      // The shell mounts again after each sign-in; one check loop is enough.
      if (!registration || checking) return;
      checking = true;
      setInterval(() => void registration.update().catch(() => undefined), UPDATE_CHECK_MS);
    },
  });
  if (!needRefresh) return null;
  return (
    <Callout
      tone="info"
      role="status"
      icon={<RefreshCwIcon />}
      title={t('pwa.update.title')}
      action={
        <Button size="sm" onClick={() => void updateServiceWorker(true)}>
          {t('pwa.update.refresh')}
        </Button>
      }
    />
  );
}
