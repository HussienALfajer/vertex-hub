import { useQueries, useQuery } from '@tanstack/react-query';
import {
  type FileItem,
  type FileVersion,
  isInlineMimeType,
  type TaskDetail,
} from '@vertex-hub/contracts';
import { Badge, Button, cn, IconButton, Skeleton, Switch, toast } from '@vertex-hub/ui';
import { ArchiveRestoreIcon, LockIcon, PlusIcon, XIcon } from 'lucide-react';
import {
  type DragEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { businessDay, formatCalendarDate, formatNumber } from '../../lib/format';
import { useFocusAfterChange } from '../../lib/use-focus-after-change';
import { AddFilesDialog, useFileItemActions } from '../files/file-dialogs';
import { type FileItemActions, FileItemCard, OpenButton } from '../files/file-item-card';
import { FileThumbnail, latestVersion, RemovedBadge } from '../files/file-parts';
import { useFileViewer, type ViewerItem } from '../files/file-viewer';
import {
  type FileOwnerRef,
  fileContentUrl,
  fileDownloadUrl,
  fileItemsQuery,
  filePreviewUrl,
  useRestoreFileItem,
} from '../files/files.queries';
import { namedFiles, pastedFiles } from '../files/held-uploads';
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
  // F06B rule C3: files dropped or pasted on the section open the references dialog with them.
  const [dropped, setDropped] = useState<File[] | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const { open: openViewer, viewer } = useFileViewer();
  // A removed file leaves with the menu that removed it: the focus goes to the section heading.
  const heading = useRef<HTMLHeadingElement>(null);
  const addButtons = {
    deliverable: useRef<HTMLButtonElement>(null),
    reference: useRef<HTMLButtonElement>(null),
  };
  const { actions, dialogs } = useFileItemActions(owner, {
    allowLink: true,
    afterItemRemoved: heading,
  });

  const deliverableActions = useViewerActions(actions, 'deliverable', openViewer);
  const referenceActions = useViewerActions(actions, 'reference', openViewer);
  const attachmentActions = useViewerActions(actions, 'attachment', openViewer);

  const total = task.fileCounts.deliverables + task.fileCounts.references;
  const rights = files.data?.rights;
  const deliverables = files.data?.items.filter((item) => item.role === 'deliverable') ?? [];
  const references = files.data?.items.filter((item) => item.role === 'reference') ?? [];
  const attachments = files.data?.items.filter((item) => item.role === 'attachment') ?? [];
  const canDrop = rights?.canAddReference === true && !isClosed(task);
  const receive = (picked: File[], pasted: boolean) => {
    if (!canDrop || picked.length === 0) return;
    setDropped(namedFiles(picked, new Date(), pasted));
    setAdding('reference');
  };
  // A paste anywhere on the page outside a field lands here; the thread's editor takes its own.
  const receiveRef = useRef(receive);
  receiveRef.current = receive;
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const pasted = pastedFiles(event);
      if (!pasted || pasted.length === 0) return;
      event.preventDefault();
      receiveRef.current(pasted, true);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);
  // The list refreshes after a dialog gave the focus back to a control the change replaced (a
  // restore swaps its button for "remove").
  const removedCount = files.data?.items.filter((item) => item.archivedAt !== null).length ?? 0;
  useFocusAfterChange(
    files.data ? `${files.data.items.length}:${removedCount}` : null,
    () => heading.current,
  );
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
      headingRef={heading}
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
      {canDrop && (
        // biome-ignore lint/a11y/noStaticElementInteractions: dropping is a shortcut; the add buttons pick files
        <div
          onDragOver={(event: DragEvent) => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event: DragEvent) => {
            event.preventDefault();
            setDragging(false);
            receive([...event.dataTransfer.files], false);
          }}
          className={cn(
            'rounded-md border border-dashed border-border px-3 py-2 text-center text-sm text-muted-foreground',
            dragging && 'border-primary bg-muted',
          )}
        >
          {t('tasks.files.dropHint')}
        </div>
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
                <Button
                  ref={addButtons.deliverable}
                  variant="ghost"
                  size="sm"
                  onClick={() => setAdding('deliverable')}
                >
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
                    actions={deliverableActions}
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
                <Button
                  ref={addButtons.reference}
                  variant="ghost"
                  size="sm"
                  onClick={() => setAdding('reference')}
                >
                  <PlusIcon />
                  {t('tasks.files.addReferences')}
                </Button>
              )
            }
          >
            {references.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('tasks.files.noReferences')}</p>
            ) : (
              <ReferenceGrid items={references} actions={referenceActions} />
            )}
          </Group>
          {attachments.length > 0 && (
            <Group title={t('tasks.files.inDiscussion')} count={attachments.length} action={null}>
              <ReferenceGrid items={attachments} actions={attachmentActions} />
            </Group>
          )}
          <SubtaskFinals task={task} onView={openViewer} />
        </>
      )}
      {viewer}

      {adding === 'deliverable' && (
        <AddFilesDialog
          owner={owner}
          fileRole="deliverable"
          title={t('tasks.files.addDeliverableTitle')}
          description={t('tasks.files.addDeliverableBody')}
          withNote
          allowLink
          onClose={() => setAdding(null)}
          finalFocus={() => focusOr(addButtons.deliverable, heading)}
        />
      )}
      {adding === 'reference' && (
        <AddFilesDialog
          owner={owner}
          fileRole="reference"
          title={t('tasks.files.addReferencesTitle')}
          description={t('tasks.files.addReferencesBody')}
          initialFiles={dropped}
          onClose={() => {
            setAdding(null);
            setDropped(undefined);
          }}
          finalFocus={() => focusOr(addButtons.reference, heading)}
        />
      )}
      {dialogs}
    </TaskSection>
  );
}

/** The button that opened a dialog, or the heading when the change took it off the page. */
const focusOr = (
  button: RefObject<HTMLElement | null>,
  heading: RefObject<HTMLElement | null>,
): HTMLElement | true => (button.current?.isConnected ? button.current : heading.current) ?? true;

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

/** F06B rule C4: an uploaded image or video the browser shows, as the viewer takes it. */
export function viewerItem(name: string, version: FileVersion, details: string): ViewerItem | null {
  if (version.kind !== 'upload') return null;
  const image =
    version.type === 'image' &&
    (version.previewStatus === 'ready' || isInlineMimeType(version.mimeType));
  const video = version.type === 'video' && isInlineMimeType(version.mimeType);
  if (!image && !video) return null;
  return {
    key: version.id,
    kind: image ? 'image' : 'video',
    src:
      image && version.previewStatus === 'ready'
        ? filePreviewUrl(version.id)
        : fileContentUrl(version.id),
    name,
    details,
    downloadHref: fileDownloadUrl(version.id),
  };
}

type OpenViewer = (items: ViewerItem[], index: number) => void;

type ViewedRole = 'deliverable' | 'reference' | 'attachment';

/** Rule C4: the viewer shows the version, the role and the uploader under the name. */
function useViewerDetails() {
  const { t } = useTranslation();
  return (version: FileVersion, role: ViewedRole, from?: string) =>
    [
      t('tasks.files.viewerVersion', { n: formatNumber(version.number) }),
      t(`tasks.files.roles.${role}`),
      version.uploadedBy.name,
      from,
    ]
      .filter(Boolean)
      .join(' · ');
}

/**
 * The file actions with previews of images and videos in the viewer (rule C4) across the shown
 * set; PDFs, links and other files keep F10's preview.
 */
function useViewerActions(
  actions: FileItemActions,
  role: ViewedRole,
  onView: OpenViewer,
): FileItemActions {
  const details = useViewerDetails();
  return {
    ...actions,
    onPreview: (entries, index) => {
      const items = entries.map((entry) =>
        viewerItem(entry.name, entry.version, details(entry.version, role)),
      );
      const target = items[index];
      if (!target) {
        actions.onPreview(entries, index);
        return;
      }
      const viewable = items.filter((item): item is ViewerItem => item !== null);
      onView(viewable, viewable.indexOf(target));
    },
  };
}

/**
 * F06B rule A7: the final deliverables of the delivered subtasks, under "From subtasks". Each
 * subtask's files are read through its own list (F10 rights apply per task).
 */
function SubtaskFinals({ task, onView }: { task: TaskDetail; onView: OpenViewer }) {
  const { t } = useTranslation();
  const delivered = task.subtasks.filter((subtask) => subtask.status === 'delivered');
  const lists = useQueries({
    queries: delivered.map((subtask) =>
      fileItemsQuery({ ownerType: 'task', ownerId: subtask.id, role: 'deliverable' }),
    ),
  });
  const finals = delivered.flatMap((subtask, index) =>
    (lists[index]?.data?.items ?? []).flatMap((item) =>
      item.versions
        .filter((version) => version.isFinal && !version.archivedAt)
        .map((version) => ({ subtask, item, version })),
    ),
  );
  const details = useViewerDetails();
  if (finals.length === 0) return null;
  const items = finals.map(({ subtask, item, version }) =>
    viewerItem(item.name, version, details(version, 'deliverable', subtask.title)),
  );
  const viewable = items.filter((item): item is ViewerItem => item !== null);
  return (
    <Group title={t('tasks.files.fromSubtasks')} count={finals.length} action={null}>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {finals.map(({ subtask, item, version }, index) => {
          const view = items[index];
          return (
            <li
              key={version.id}
              className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-2"
            >
              {view ? (
                <button
                  type="button"
                  className="rounded-md focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label={t('files.previewNamed', { name: item.name })}
                  onClick={() => onView(viewable, viewable.indexOf(view))}
                >
                  <FileThumbnail version={version} className="aspect-4/3 w-full" />
                </button>
              ) : (
                <FileThumbnail version={version} className="aspect-4/3 w-full" />
              )}
              <span className="truncate text-sm font-medium" dir="auto">
                {item.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">{subtask.title}</span>
              <div className="flex">
                <OpenButton version={version} name={item.name} />
              </div>
            </li>
          );
        })}
      </ul>
    </Group>
  );
}

/**
 * References and attachments: single uploads in a grid. Images and videos open in the viewer
 * (F06B rule C4) across the group; PDFs and other files keep F10's preview.
 */
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
                  <IconButton
                    label={t('common.remove', { label: item.name })}
                    onClick={() =>
                      actions.onRemove({ kind: 'item', id: item.id, label: item.name })
                    }
                  >
                    <XIcon />
                  </IconButton>
                )}
                {removed && item.permissions.canRestore && (
                  <IconButton
                    label={t('files.restoreNamed', { name: item.name })}
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
                  </IconButton>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
