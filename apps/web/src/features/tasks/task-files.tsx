import { useQuery } from '@tanstack/react-query';
import type { FileItem, FileVersion, TaskDetail } from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
  Switch,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveRestoreIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleOffIcon,
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  EyeIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { businessDay, formatCalendarDate, formatDateTime, formatNumber } from '../../lib/format';
import { AddFilesDialog, NewVersionDialog, RenameFileDialog } from '../files/file-dialogs';
import {
  FileThumbnail,
  FinalBadge,
  latestVersion,
  RemovedBadge,
  VersionBadge,
  versionSize,
} from '../files/file-parts';
import { FilePreviewDialog, type PreviewEntry } from '../files/file-preview-dialog';
import {
  type FileOwnerRef,
  fileDownloadUrl,
  fileItemsQuery,
  useArchiveFileItem,
  useArchiveFileVersion,
  useRestoreFileItem,
  useRestoreFileVersion,
  useSetFileFinal,
} from '../files/files.queries';
import { TaskSection } from './task-parts';

/*
 * The task's Files section (spec F10, screen 2): deliverables with their version chains and the
 * final marker, and references. The API's `rights` and `permissions` decide every action.
 */

type Removing = { kind: 'item' | 'version'; id: string; label: string } | null;

type Preview = { entries: PreviewEntry[]; index: number } | null;

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
  const [versioning, setVersioning] = useState<FileItem | null>(null);
  const [renaming, setRenaming] = useState<FileItem | null>(null);
  const [removing, setRemoving] = useState<Removing>(null);
  const [preview, setPreview] = useState<Preview>(null);
  const archiveItem = useArchiveFileItem(owner);
  const archiveVersion = useArchiveFileVersion(owner);

  const total = task.fileCounts.deliverables + task.fileCounts.references;
  const rights = files.data?.rights;
  const deliverables = files.data?.items.filter((item) => item.role === 'deliverable') ?? [];
  const references = files.data?.items.filter((item) => item.role === 'reference') ?? [];

  const actions: CardActions = {
    owner,
    task,
    onPreview: (entries, index) => setPreview({ entries, index }),
    onNewVersion: setVersioning,
    onRename: setRenaming,
    onRemove: setRemoving,
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
                  <DeliverableCard key={item.id} item={item} actions={actions} />
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
      {versioning && (
        <NewVersionDialog
          owner={owner}
          item={versioning}
          allowLink
          onClose={() => setVersioning(null)}
        />
      )}
      {renaming && (
        <RenameFileDialog owner={owner} item={renaming} onClose={() => setRenaming(null)} />
      )}
      {preview && (
        <FilePreviewDialog
          entries={preview.entries}
          index={preview.index}
          onIndexChange={(index) => setPreview({ ...preview, index })}
          onClose={() => setPreview(null)}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t(
          removing?.kind === 'version' ? 'files.removeVersionTitle' : 'files.removeItemTitle',
        )}
        body={t(removing?.kind === 'version' ? 'files.removeVersionBody' : 'files.removeItemBody', {
          label: removing?.label ?? '',
        })}
        action={t('files.removeAction')}
        destructive
        pending={archiveItem.isPending || archiveVersion.isPending}
        onConfirm={async () => {
          if (removing?.kind === 'item') await archiveItem.mutateAsync(removing.id);
          if (removing?.kind === 'version') await archiveVersion.mutateAsync(removing.id);
          toast.add({ title: t('files.removedDone'), type: 'success' });
        }}
      />
    </TaskSection>
  );
}

interface CardActions {
  owner: FileOwnerRef;
  task: TaskDetail;
  onPreview: (entries: PreviewEntry[], index: number) => void;
  onNewVersion: (item: FileItem) => void;
  onRename: (item: FileItem) => void;
  onRemove: (removing: Removing) => void;
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

/** Who added a version and when, and its size or the link's host. */
function VersionMeta({ version }: { version: FileVersion }) {
  return (
    <span className="text-xs text-muted-foreground">
      {[version.uploadedBy.name, formatDateTime(version.createdAt), versionSize(version)]
        .filter(Boolean)
        .join(' · ')}
    </span>
  );
}

/** Download an upload, open a link. */
function OpenButton({ version, name }: { version: FileVersion; name: string }) {
  const { t } = useTranslation();
  return version.kind === 'upload' ? (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t('files.downloadNamed', { name })}
      render={<a href={fileDownloadUrl(version.id)} />}
    >
      <DownloadIcon />
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t('files.openLinkNamed', { name })}
      render={<a href={version.url ?? ''} target="_blank" rel="noopener noreferrer" />}
    >
      <ExternalLinkIcon />
    </Button>
  );
}

const entriesOf = (item: FileItem, versions: FileVersion[]): PreviewEntry[] =>
  versions.map((version) => ({ name: item.name, version }));

function DeliverableCard({ item, actions }: { item: FileItem; actions: CardActions }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const historyId = useId();
  const restore = useRestoreFileItem(actions.owner);
  const live = item.versions.filter((version) => !version.archivedAt);
  const latest = latestVersion(item.versions) ?? item.versions[0];
  const final = live.find((version) => version.isFinal);
  const removed = item.archivedAt !== null;
  const { permissions } = item;
  if (!latest) return null;
  const previewAt = (version: FileVersion) =>
    actions.onPreview(entriesOf(item, live), Math.max(0, live.indexOf(version)));

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-md border border-border p-3',
        removed && 'bg-muted',
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="rounded-md focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={t('files.previewNamed', { name: item.name })}
          onClick={() => previewAt(latest)}
        >
          <FileThumbnail version={latest} className="size-16" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate font-medium" dir="auto">
              {item.name}
            </span>
            <VersionBadge number={latest.number} />
            {final &&
              (final.id === latest.id ? (
                <FinalBadge />
              ) : (
                <Badge tone="success">{t('files.finalIs', { number: final.number })}</Badge>
              ))}
            {removed && <RemovedBadge />}
          </div>
          {latest.note && <p className="text-sm whitespace-pre-line">{latest.note}</p>}
          <VersionMeta version={latest} />
        </div>
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('files.previewNamed', { name: item.name })}
            onClick={() => previewAt(latest)}
          >
            <EyeIcon />
          </Button>
          <OpenButton version={latest} name={item.name} />
          {removed
            ? permissions.canRestore && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={restore.isPending}
                  onClick={() =>
                    restore
                      .mutateAsync(item.id)
                      .then(() => toast.add({ title: t('files.restoredDone'), type: 'success' }))
                      .catch((error) => toast.add({ title: errorMessage(t, error), type: 'error' }))
                  }
                >
                  <ArchiveRestoreIcon />
                  {t('files.restore')}
                </Button>
              )
            : (permissions.canAddVersion || permissions.canRename || permissions.canRemove) && (
                <ItemMenu item={item} actions={actions} />
              )}
        </div>
      </div>
      <div>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={historyId}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDownIcon className={cn('transition-transform', expanded && 'rotate-180')} />
          {t('files.versions', {
            count: item.versions.length,
            n: formatNumber(item.versions.length),
          })}
        </Button>
      </div>
      {expanded && (
        <ol id={historyId} className="flex flex-col gap-2 border-s-2 border-border ps-3">
          {item.versions.map((version) => (
            <VersionRow
              key={version.id}
              item={item}
              version={version}
              liveCount={live.length}
              actions={actions}
              onPreview={() => previewAt(version)}
            />
          ))}
        </ol>
      )}
    </li>
  );
}

function ItemMenu({ item, actions }: { item: FileItem; actions: CardActions }) {
  const { t } = useTranslation();
  const { permissions } = item;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('files.actionsFor', { name: item.name })}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {permissions.canAddVersion && (
          <DropdownMenuItem onClick={() => actions.onNewVersion(item)}>
            <UploadIcon />
            {t('files.newVersion')}
          </DropdownMenuItem>
        )}
        {permissions.canRename && (
          <DropdownMenuItem onClick={() => actions.onRename(item)}>
            <PencilIcon />
            {t('files.rename')}
          </DropdownMenuItem>
        )}
        {permissions.canRemove && (
          <DropdownMenuItem
            variant="destructive"
            onClick={() => actions.onRemove({ kind: 'item', id: item.id, label: item.name })}
          >
            <XIcon />
            {t('files.remove')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One version in the history, with the final marker's actions (rule 10). */
function VersionRow({
  item,
  version,
  liveCount,
  actions,
  onPreview,
}: {
  item: FileItem;
  version: FileVersion;
  liveCount: number;
  actions: CardActions;
  onPreview: () => void;
}) {
  const { t } = useTranslation();
  const setFinal = useSetFileFinal(actions.owner);
  const restore = useRestoreFileVersion(actions.owner);
  const { status } = actions.task;
  const removed = version.archivedAt !== null;
  const live = !removed && !item.archivedAt;
  const canMark =
    live &&
    item.permissions.canSetFinal &&
    !version.isFinal &&
    (status === 'approved' || status === 'delivered');
  const canClear = live && item.permissions.canSetFinal && version.isFinal;
  const canRemove =
    live &&
    item.permissions.canAddVersion &&
    version.canRemove &&
    !version.isFinal &&
    liveCount > 1;
  const label = t('files.versionNamed', { name: item.name, number: version.number });

  async function attempt(action: Promise<unknown>, done: string) {
    try {
      await action;
      toast.add({ title: done, type: 'success' });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  return (
    <li className="flex flex-wrap items-start gap-2 text-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <VersionBadge number={version.number} />
          {version.isFinal && <FinalBadge />}
          {version.isFinal && (
            <span className="text-xs text-muted-foreground">
              {version.finalSource === 'auto'
                ? t('files.finalAuto')
                : t('files.finalBy', { name: version.finalMarkedBy?.name ?? '' })}
            </span>
          )}
          {removed && <RemovedBadge />}
        </div>
        {version.note && <p className="whitespace-pre-line">{version.note}</p>}
        <VersionMeta version={version} />
      </div>
      <div className="flex shrink-0 flex-wrap items-center">
        {!removed && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('files.previewNamed', { name: label })}
            onClick={onPreview}
          >
            <EyeIcon />
          </Button>
        )}
        <OpenButton version={version} name={label} />
        {canMark && (
          <Button
            variant="ghost"
            size="sm"
            disabled={setFinal.isPending}
            onClick={() =>
              attempt(
                setFinal.mutateAsync({ versionId: version.id, final: true }),
                t('files.finalSet', { number: version.number }),
              )
            }
          >
            <CircleCheckIcon />
            {t('files.markFinal')}
          </Button>
        )}
        {canClear && (
          <Button
            variant="ghost"
            size="sm"
            disabled={setFinal.isPending}
            onClick={() =>
              attempt(
                setFinal.mutateAsync({ versionId: version.id, final: false }),
                t('files.finalCleared'),
              )
            }
          >
            <CircleOffIcon />
            {t('files.clearFinal')}
          </Button>
        )}
        {canRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.remove', { label })}
            onClick={() => actions.onRemove({ kind: 'version', id: version.id, label })}
          >
            <XIcon />
          </Button>
        )}
        {removed && !item.archivedAt && item.permissions.canRestore && (
          <Button
            variant="ghost"
            size="sm"
            disabled={restore.isPending}
            onClick={() => attempt(restore.mutateAsync(version.id), t('files.restoredDone'))}
          >
            <ArchiveRestoreIcon />
            {t('files.restore')}
          </Button>
        )}
      </div>
    </li>
  );
}

/** References: single uploads in a grid; preview moves through the whole group. */
function ReferenceGrid({ items, actions }: { items: FileItem[]; actions: CardActions }) {
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
