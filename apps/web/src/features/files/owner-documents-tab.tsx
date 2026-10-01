import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Skeleton, Switch } from '@vertex-hub/ui';
import { FileTextIcon, UploadIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
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
  const { actions, dialogs } = useFileItemActions(owner, { allowLink: true });
  const rights = files.data?.rights;
  const items = files.data?.items ?? [];

  const upload = rights?.canManageDocuments && (
    <Button size="sm" onClick={() => setAdding(true)}>
      <UploadIcon />
      {t('files.documents.upload')}
    </Button>
  );

  return (
    <>
      <TabHeader
        title={t('files.documents.title')}
        description={t(`files.documents.hint.${owner.type}`)}
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
        />
      )}
      {dialogs}
    </>
  );
}
