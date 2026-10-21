import { useQuery } from '@tanstack/react-query';
import { ANNOUNCEMENT_LIMITS } from '@vertex-hub/contracts';
import { Button, Skeleton } from '@vertex-hub/ui';
import { PaperclipIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatNumber } from '../../lib/format';
import { AddFilesDialog, useFileItemActions } from '../files/file-dialogs';
import { FileItemCard } from '../files/file-item-card';
import { fileItemsQuery } from '../files/files.queries';

/**
 * An announcement's attachments (F10 owner type `announcement`, role `attachment`): every reader
 * opens them; the author adds, renames and removes them, at most five.
 */
export function AnnouncementAttachments({
  announcementId,
  heading = true,
}: {
  announcementId: string;
  /** The editor gives the section its own heading. */
  heading?: boolean;
}) {
  const { t } = useTranslation();
  const owner = { type: 'announcement' as const, id: announcementId };
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const files = useQuery(
    fileItemsQuery({ ownerType: 'announcement', ownerId: announcementId, role: 'attachment' }),
  );
  const { actions, dialogs } = useFileItemActions(owner, {
    allowLink: false,
    afterItemRemoved: addButton,
  });
  const items = files.data?.items ?? [];
  const editable = files.data?.rights.canManageDocuments ?? false;
  const full = items.length >= ANNOUNCEMENT_LIMITS.attachments;

  if (files.isPending) return <Skeleton className="h-20" />;
  if (files.isError) {
    return (
      <LoadError
        message={t('announcements.attachments.loadError')}
        onRetry={() => files.refetch()}
      />
    );
  }
  if (items.length === 0 && !editable) return null;

  return (
    <section className="flex flex-col gap-3">
      {(heading || editable) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {heading && (
            <h2 className="flex items-center gap-2 text-base font-medium">
              <PaperclipIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              {t('announcements.attachments.title')}
            </h2>
          )}
          {editable && (
            <Button
              ref={addButton}
              size="sm"
              variant="outline"
              disabled={full}
              focusableWhenDisabled
              onClick={() => setAdding(true)}
            >
              <PaperclipIcon />
              {t('announcements.attachments.add')}
            </Button>
          )}
        </div>
      )}
      {editable && (
        <p className="text-sm text-muted-foreground">
          {full
            ? t('announcements.attachments.full', {
                n: formatNumber(ANNOUNCEMENT_LIMITS.attachments),
              })
            : t('announcements.attachments.hint', {
                n: formatNumber(ANNOUNCEMENT_LIMITS.attachments),
              })}
        </p>
      )}
      {items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <FileItemCard key={item.id} item={item} actions={actions} />
          ))}
        </ul>
      )}
      {adding && (
        <AddFilesDialog
          owner={owner}
          fileRole="attachment"
          title={t('announcements.attachments.addTitle')}
          description={t('announcements.attachments.addBody', {
            n: formatNumber(ANNOUNCEMENT_LIMITS.attachments - items.length),
          })}
          onClose={() => setAdding(false)}
          finalFocus={() => addButton.current ?? true}
        />
      )}
      {dialogs}
    </section>
  );
}
