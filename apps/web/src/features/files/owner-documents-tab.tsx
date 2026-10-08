import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Skeleton, Switch } from '@vertex-hub/ui';
import { FileTextIcon, UploadIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
import { useFocusAfterChange } from '../../lib/use-focus-after-change';
import { AddFilesDialog, useFileItemActions } from './file-dialogs';
import { FileItemCard } from './file-item-card';
import { type FileOwnerRef, fileItemsQuery } from './files.queries';

/**
 * The Documents tab of a project or a retainer (spec F10, screen 5): its documents with their
 * versions, the confidential lock, and upload for those who manage its documents.
 */
export function OwnerDocumentsTab({
  owner,
}: {
  owner: FileOwnerRef & { type: 'project' | 'retainer' };
}) {
  const { t } = useTranslation();
  const showRemovedId = useId();
  const [showRemoved, setShowRemoved] = useState(false);
  const [adding, setAdding] = useState(false);
  const files = useQuery(
    fileItemsQuery({
      ownerType: owner.type,
      ownerId: owner.id,
      role: 'document',
      ...(showRemoved && { includeArchived: 'true' }),
    }),
  );
  // Only one upload button shows at a time (header or empty state): the focus goes to it after an
  // upload or a removal changed which one shows, or the heading when none does.
  const uploadButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const { actions, dialogs } = useFileItemActions(owner, {
    allowLink: true,
    afterItemRemoved: uploadButton,
  });
  const rights = files.data?.rights;
  const items = files.data?.items ?? [];
  // The list refreshes after the dialog gave the focus back (to a button an upload or a removal
  // then replaced): once it shows, a focus left on the page body goes to the upload button.
  useFocusAfterChange(items.length, () => uploadButton.current ?? heading.current);

  const upload = rights?.canManageDocuments && (
    <Button ref={uploadButton} size="sm" onClick={() => setAdding(true)}>
      <UploadIcon />
      {t('files.documents.upload')}
    </Button>
  );

  return (
    <>
      <TabHeader
        title={t('files.documents.title')}
        description={t(`files.documents.hint.${owner.type}`)}
        headingRef={heading}
        action={
          <div className="flex flex-wrap items-center gap-3">
            {rights?.canSeeRemoved && (
              <label htmlFor={showRemovedId} className="flex items-center gap-2 text-sm">
                <Switch id={showRemovedId} checked={showRemoved} onCheckedChange={setShowRemoved} />
                {t('files.showRemoved')}
              </label>
            )}
            {items.length > 0 && upload}
          </div>
        }
      />
      {files.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : files.isError ? (
        <LoadError message={t('files.documents.loadError')} onRetry={() => files.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FileTextIcon />}
          title={t('files.documents.emptyTitle')}
          description={rights?.canManageDocuments ? t('files.documents.emptyHint') : undefined}
          action={upload}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <FileItemCard key={item.id} item={item} actions={actions} />
          ))}
        </ul>
      )}
      {adding && (
        <AddFilesDialog
          owner={owner}
          fileRole="document"
          title={t('files.documents.uploadTitle')}
          description={t('files.documents.uploadBody')}
          withNote
          allowLink
          withConfidential={rights?.canSetConfidential}
          onClose={() => setAdding(false)}
          finalFocus={() => uploadButton.current ?? heading.current ?? true}
        />
      )}
      {dialogs}
    </>
  );
}
