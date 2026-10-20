import { Link } from '@tanstack/react-router';
import { Button, Callout } from '@vertex-hub/ui';
import { DownloadIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dismissInstallCard, installCardDismissed, useInstallOffer } from './install';

/**
 * F16 screen 1 and rule A3: the home page invites to install, once per device, until the app is
 * installed or the card is dismissed for 30 days. iPhone gets the guide instead of a prompt.
 */
export function InstallCard() {
  const { t } = useTranslation();
  const { offer, install } = useInstallOffer();
  const [dismissed, setDismissed] = useState(installCardDismissed);
  if (offer === 'none' || dismissed) return null;
  return (
    <Callout
      tone="info"
      icon={<DownloadIcon />}
      title={t('pwa.install.cardTitle')}
      description={t('pwa.install.cardBody')}
      action={
        <>
          {offer === 'prompt' ? (
            <Button size="sm" onClick={() => void install()}>
              {t('pwa.install.install')}
            </Button>
          ) : (
            <Button size="sm" render={<Link to="/install" />}>
              {t('pwa.install.how')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              dismissInstallCard();
              setDismissed(true);
            }}
          >
            {t('pwa.install.notNow')}
          </Button>
        </>
      }
    />
  );
}
