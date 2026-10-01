import { useQuery } from '@tanstack/react-query';
import { BRAND_FILE_KINDS } from '@vertex-hub/contracts';
import { Button, Card, CardHeader, CardTitle, Skeleton, Switch } from '@vertex-hub/ui';
import { FolderUpIcon, UploadIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { AddFilesDialog, useFileItemActions } from './file-dialogs';
import { FileItemCard } from './file-item-card';
import { type FileOwnerRef, fileItemsQuery } from './files.queries';

/**
 * The brand kit's uploaded files (spec F10, screen 4), grouped by the F02 kinds, next to the
 * kit's links. Replacing a logo adds a version.
 */
export function BrandFilesCard({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const owner: FileOwnerRef = { type: 'client', id: clientId };
  const showRemovedId = useId();
  const [showRemoved, setShowRemoved] = useState(false);
  const [adding, setAdding] = useState(false);
  const files = useQuery(
    fileItemsQuery({
      ownerType: 'client',
      ownerId: clientId,
      role: 'brand',
      ...(showRemoved && { includeArchived: 'true' }),
    }),
  );
  const { actions, dialogs } = useFileItemActions(owner, { allowLink: true });
  const rights = files.data?.rights;
  const items = files.data?.items ?? [];

  return (
    <Card className="lg:col-span-3">
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FolderUpIcon aria-hidden="true" className="size-5 text-muted-foreground" />
            {t('files.brand.title')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t('files.brand.hint')}</p>
        </div>
        {rights?.canSeeRemoved && (
          <label htmlFor={showRemovedId} className="flex items-center gap-2 text-sm">
            <Switch id={showRemovedId} checked={showRemoved} onCheckedChange={setShowRemoved} />
            {t('files.showRemoved')}
          </label>
        )}
        {rights?.canManageDocuments && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <UploadIcon />
            {t('files.brand.upload')}
          </Button>
        )}
      </CardHeader>
      {files.isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-24" />
        </div>
      ) : files.isError ? (
        <LoadError message={t('files.brand.loadError')} onRetry={() => files.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">{t('files.brand.empty')}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {BRAND_FILE_KINDS.filter((kind) => items.some((item) => item.brandKind === kind)).map(
            (kind) => (
              <section key={kind} className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {t(`clients.brandKit.fileKinds.${kind}`)}
                </h3>
                <ul className="flex flex-col gap-3">
                  {items
                    .filter((item) => item.brandKind === kind)
                    .map((item) => (
                      <FileItemCard key={item.id} item={item} actions={actions} />
                    ))}
                </ul>
              </section>
            ),
          )}
        </div>
      )}
      {adding && (
        <AddFilesDialog
          owner={owner}
          fileRole="brand"
          title={t('files.brand.uploadTitle')}
          description={t('files.brand.uploadBody')}
          withNote
          allowLink
          onClose={() => setAdding(false)}
        />
      )}
      {dialogs}
    </Card>
  );
}
