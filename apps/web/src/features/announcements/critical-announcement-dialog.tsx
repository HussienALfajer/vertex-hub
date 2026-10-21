import { useQuery } from '@tanstack/react-query';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@vertex-hub/ui';
import { OctagonAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';
import { AnnouncementContent } from './announcement-page';
import { announcementHomeQuery } from './announcements.queries';

/**
 * Rule D6 and screen 10: when the app opens or regains focus, the caller's unacknowledged
 * critical announcements show one by one. The dialog has no close button and ignores Escape and
 * outside clicks: only "I have read this" closes it. Links and attachments stay usable.
 */
export function CriticalAnnouncementDialog() {
  const { t } = useTranslation();
  const home = useQuery(announcementHomeQuery);
  const pending = home.data?.critical ?? [];
  const current = pending[0];
  return (
    <AlertDialog open={!!current} onOpenChange={() => undefined}>
      {current && (
        <AlertDialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <AlertDialogHeader>
            <p className="flex items-center gap-2 text-sm font-medium text-destructive-text">
              <OctagonAlertIcon className="size-4" aria-hidden="true" />
              {pending.length > 1
                ? t('announcements.critical.countOf', { n: formatNumber(pending.length) })
                : t('announcements.critical.label')}
            </p>
            <AlertDialogTitle>{current.title}</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              {t('announcements.critical.hint')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AnnouncementContent key={current.id} announcement={current} />
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
