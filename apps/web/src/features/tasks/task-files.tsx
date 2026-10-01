import { useQuery } from '@tanstack/react-query';
import type { FileItem, FileVersion, TaskDetail } from '@vertex-hub/contracts';
import { Badge, Button, cn, Skeleton, Switch, toast } from '@vertex-hub/ui';
import { ArchiveRestoreIcon, LockIcon, PlusIcon, XIcon } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { businessDay, formatCalendarDate, formatNumber } from '../../lib/format';
import { AddFilesDialog, useFileItemActions } from '../files/file-dialogs';
import { type FileItemActions, FileItemCard, OpenButton } from '../files/file-item-card';
import { FileThumbnail, latestVersion, RemovedBadge } from '../files/file-parts';
import { type FileOwnerRef, fileItemsQuery, useRestoreFileItem } from '../files/files.queries';
import { TaskSection } from './task-parts';
import { reviewSnapshot } from './task-review';

/*
 * The task's Files section (spec F10, screen 2): deliverables with their version chains and the
 * final marker, and references. The API's `rights` and `permissions` decide every action. While
 * the work is with the medical reviewer or the client, each deliverable says which version went
 * and which were added after the review (F09 rule 2, edge case 3).
 */

/** Rule 5: a delivered or cancelled task keeps its files as they are. */
const isClosed = (task: TaskDetail) => task.status === 'delivered' || task.status === 'cancelled';

export function TaskFilesSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const owner: FileOwnerRef = { type: 'task', id: task.id };
  const showRemovedId = useId();
  const [showRemoved, setShowRemoved] = useState(false);
  const files = useQuery(
    fileItemsQuery({
      ownerType: 'task',
      ownerId: task.id,
      ...(showRemoved && { includeArchived: 'true' }),
    }),
  );
  const [adding, setAdding] = useState<'deliverable' | 'reference' | null>(null);
  const { actions, dialogs } = useFileItemActions(owner, { allowLink: true });

  const total = task.fileCounts.deliverables + task.fileCounts.references;
  const rights = files.data?.rights;
  const deliverables = files.data?.items.filter((item) => item.role === 'deliverable') ?? [];
  const references = files.data?.items.filter((item) => item.role === 'reference') ?? [];
  // Rule 10: the final marker is set by hand on an approved or delivered task.
  const finalMarkable = task.status === 'approved' || task.status === 'delivered';
  const snapshot = reviewSnapshot(task);
  const versionMark = (item: FileItem) => (version: FileVersion) => {
    if (!snapshot) return null;
    const reviewed = snapshot.review.versions.find((sent) => sent.fileItemId === item.id);
    if (reviewed?.id === version.id) {
      return (
        <Badge tone="info">
          {snapshot.at === 'client'
            ? t('tasks.files.sentToClient')
            : t('tasks.files.inMedicalReview')}
        </Badge>
      );
    }
    return !reviewed || version.number > reviewed.number ? (
      <Badge tone="warning">{t('tasks.files.addedAfterReview')}</Badge>
    ) : null;
  };

  return (
    <TaskSection
      title={t('tasks.files.title')}
      count={total > 0 ? formatNumber(total) : undefined}
      action={
        rights?.canSeeRemoved && (
          <label htmlFor={showRemovedId} className="flex items-center gap-2 text-sm">
            <Switch id={showRemovedId} checked={showRemoved} onCheckedChange={setShowRemoved} />
            {t('files.showRemoved')}
          </label>
        )
      }
    >
      {isClosed(task) && !task.archivedAt && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LockIcon aria-hidden="true" className="size-4 shrink-0" />
          {t('tasks.files.closedHint')}
        </p>
      )}
      {files.isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : files.isError ? (
        <LoadError message={t('tasks.files.loadError')} onRetry={() => files.refetch()} />
      ) : (
        <>
          <Group
            title={t('tasks.files.deliverables')}
            count={deliverables.length}
            action={
              rights?.canAddDeliverable && (
                <Button variant="ghost" size="sm" onClick={() => setAdding('deliverable')}>
                  <PlusIcon />
                  {t('tasks.files.addDeliverable')}
                </Button>
              )
            }
          >
            {deliverables.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('tasks.files.noDeliverables')}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {deliverables.map((item) => (
                  <FileItemCard
                    key={item.id}
                    item={item}
                    actions={actions}
                    finalMarkable={finalMarkable}
                    versionMark={versionMark(item)}
                  />
                ))}
              </ul>
            )}
          </Group>
          <Group
            title={t('tasks.files.references')}
            count={references.length}
            action={
              rights?.canAddReference && (
                <Button variant="ghost" size="sm" onClick={() => setAdding('reference')}>
                  <PlusIcon />
                  {t('tasks.files.addReferences')}
                </Button>
              )
            }
          >
            {references.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('tasks.files.noReferences')}</p>
            ) : (
              <ReferenceGrid items={references} actions={actions} />
            )}
          </Group>
        </>
      )}

      {adding === 'deliverable' && (
        <AddFilesDialog
          owner={owner}
          fileRole="deliverable"
          title={t('tasks.files.addDeliverableTitle')}
          description={t('tasks.files.addDeliverableBody')}
          withNote
          allowLink
          onClose={() => setAdding(null)}
        />
      )}
      {adding === 'reference' && (
        <AddFilesDialog
          owner={owner}
          fileRole="reference"
          title={t('tasks.files.addReferencesTitle')}
          description={t('tasks.files.addReferencesBody')}
          onClose={() => setAdding(null)}
        />
      )}
      {dialogs}
    </TaskSection>
  );
}

function Group({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count: number;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3 first-of-type:border-t-0 first-of-type:pt-0">
      <div className="flex min-h-8 items-center gap-2">
        <h3 className="text-sm font-bold">{title}</h3>
        {count > 0 && (
          <span className="text-sm text-muted-foreground tabular-nums">{formatNumber(count)}</span>
        )}
        {action && <div className="ms-auto">{action}</div>}
      </div>
      {children}
    </div>
  );
}

/** References: single uploads in a grid; preview moves through the whole group. */
function ReferenceGrid({ items, actions }: { items: FileItem[]; actions: FileItemActions }) {
  const { t } = useTranslation();
  const restore = useRestoreFileItem(actions.owner);
  const shown = items.flatMap((item) => {
    const version = latestVersion(item.versions) ?? item.versions[0];
    return version ? [{ item, version }] : [];
  });
  const previewable = shown.filter(({ item }) => !item.archivedAt);
  const entries = previewable.map(({ item, version }) => ({ name: item.name, version }));
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {shown.map(({ item, version }) => {
        const removed = item.archivedAt !== null;
        return (
          <li
            key={item.id}
            className={cn(
              'flex min-w-0 flex-col gap-2 rounded-md border border-border p-2',
              removed && 'bg-muted',
            )}
          >
            <button
              type="button"
              disabled={removed}
              className="rounded-md focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={t('files.previewNamed', { name: item.name })}
              onClick={() =>
                actions.onPreview(
                  entries,
                  previewable.findIndex((entry) => entry.item.id === item.id),
                )
              }
            >
              <FileThumbnail version={version} className="aspect-4/3 w-full" />
            </button>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium" dir="auto">
                {item.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {version.uploadedBy.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {formatCalendarDate(businessDay(version.createdAt))}
              </span>
            </div>
            <div className="flex items-center">
              {removed && <RemovedBadge />}
              <div className="ms-auto flex items-center">
                <OpenButton version={version} name={item.name} />
                {!removed && item.permissions.canRemove && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('common.remove', { label: item.name })}
                    onClick={() =>
                      actions.onRemove({ kind: 'item', id: item.id, label: item.name })
                    }
                  >
                    <XIcon />
                  </Button>
                )}
                {removed && item.permissions.canRestore && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('files.restoreNamed', { name: item.name })}
                    disabled={restore.isPending}
                    onClick={() =>
                      restore
                        .mutateAsync(item.id)
                        .then(() => toast.add({ title: t('files.restoredDone'), type: 'success' }))
                        .catch((error) =>
                          toast.add({ title: errorMessage(t, error), type: 'error' }),
                        )
                    }
                  >
                    <ArchiveRestoreIcon />
                  </Button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
