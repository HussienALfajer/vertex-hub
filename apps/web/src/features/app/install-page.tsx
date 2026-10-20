import {
  Badge,
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  IconTile,
  PageHeader,
} from '@vertex-hub/ui';
import {
  BellRingIcon,
  CompassIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  type LucideIcon,
  MonitorIcon,
  MousePointerClickIcon,
  ShareIcon,
  SmartphoneIcon,
  SquarePlusIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';
import { currentApplePlatform, isStandalone, useInstallOffer } from './install';

type Platform = 'iphone' | 'android' | 'computer';

/** Each platform's steps (rule A3), as icons beside their text. */
const STEPS = {
  iphone: [
    { icon: CompassIcon, text: 'pwa.guide.iphone.safari' },
    { icon: ShareIcon, text: 'pwa.guide.iphone.share' },
    { icon: SquarePlusIcon, text: 'pwa.guide.iphone.add' },
    { icon: SmartphoneIcon, text: 'pwa.guide.iphone.open' },
    { icon: BellRingIcon, text: 'pwa.guide.iphone.notify' },
  ],
  android: [
    { icon: CompassIcon, text: 'pwa.guide.android.chrome' },
    { icon: EllipsisVerticalIcon, text: 'pwa.guide.android.menu' },
    { icon: SmartphoneIcon, text: 'pwa.guide.android.open' },
    { icon: BellRingIcon, text: 'pwa.guide.android.notify' },
  ],
  computer: [
    { icon: DownloadIcon, text: 'pwa.guide.computer.address' },
    { icon: MousePointerClickIcon, text: 'pwa.guide.computer.open' },
    { icon: BellRingIcon, text: 'pwa.guide.computer.notify' },
  ],
} as const satisfies Record<Platform, readonly { icon: LucideIcon; text: string }[]>;

const ICONS: Record<Platform, LucideIcon> = {
  iphone: SmartphoneIcon,
  android: SmartphoneIcon,
  computer: MonitorIcon,
};

function currentPlatform(): Platform {
  if (currentApplePlatform().apple) return 'iphone';
  return /Android/.test(navigator.userAgent) ? 'android' : 'computer';
}

/** F16 screen 1: the Arabic install guide, with the current device's steps first. */
export function InstallPage() {
  const { t } = useTranslation();
  const { offer, install } = useInstallOffer();
  const current = currentPlatform();
  const apple = currentApplePlatform();
  const order: Platform[] = [
    current,
    ...(['iphone', 'android', 'computer'] as const).filter((p) => p !== current),
  ];

  return (
    <>
      <PageHeader title={t('pwa.guide.title')} description={t('pwa.guide.subtitle')} />
      {isStandalone() && (
        <Callout tone="neutral" icon={<SmartphoneIcon />} title={t('pwa.guide.installed')} />
      )}
      {apple.apple && !apple.pushCapable && (
        <Callout tone="warning" icon={<TriangleAlertIcon />} title={t('pwa.guide.tooOld')} />
      )}
      {offer === 'prompt' && (
        <Callout
          tone="info"
          icon={<DownloadIcon />}
          title={t('pwa.install.cardTitle')}
          action={
            <Button size="sm" onClick={() => void install()}>
              {t('pwa.install.install')}
            </Button>
          }
        />
      )}
      {order.map((platform) => {
        const Icon = ICONS[platform];
        return (
          <Card key={platform}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
                <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
                {t(`pwa.guide.${platform}.title`)}
                {platform === current && <Badge tone="success">{t('pwa.guide.thisDevice')}</Badge>}
              </CardTitle>
              <CardDescription className="text-sm">
                {t(`pwa.guide.${platform}.hint`)}
              </CardDescription>
            </CardHeader>
            <ol className="flex flex-col gap-4">
              {STEPS[platform].map((step, index) => (
                <li key={step.text} className="flex items-start gap-3">
                  <IconTile>
                    <step.icon />
                  </IconTile>
                  <div className="flex flex-col gap-0.5 pt-1">
                    <span className="text-sm font-medium">
                      {t('pwa.guide.step', { n: formatNumber(index + 1) })}
                    </span>
                    <span className="text-sm">{t(step.text)}</span>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        );
      })}
    </>
  );
}
