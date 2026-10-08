import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type FileVersion,
  isPostContentEditable,
  isPostOpen,
  POST_LIMITS,
  type PostDetail,
  type PostMedia,
} from '@vertex-hub/contracts';
import { Badge, Button, cn, Skeleton } from '@vertex-hub/ui';
import { LockIcon, PlusIcon } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatNumber } from '../../lib/format';
import { useFocusAfterChange } from '../../lib/use-focus-after-change';
import { AddFilesDialog, useFileItemActions } from '../files/file-dialogs';
import { FileItemCard } from '../files/file-item-card';
import { FileThumbnail, VersionBadge } from '../files/file-parts';
import { type FileOwnerRef, fileItemsQuery } from '../files/files.queries';
import { TaskSection } from '../tasks/task-parts';
import { postSnapshot } from './post-review';

/*
 * The Media section of the post page (spec F08, screen 4, rule 5): the post's own files with the
 * F10 upload control, then the final files of each linked task. While the post is with the
 * medical reviewer or the client, the versions of that snapshot say so.
 */

export function PostMediaSection({ post }: { post: PostDetail }) {
  const { t } = useTranslation();
  const owner: FileOwnerRef = { type: 'post', id: post.id };
  const files = useQuery(fileItemsQuery({ ownerType: 'post', ownerId: post.id }));
  const [adding, setAdding] = useState(false);
  // A removed file leaves with the menu that removed it: the focus goes to the section heading.
  const heading = useRef<HTMLHeadingElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const { actions, dialogs } = useFileItemActions(owner, {
    allowLink: true,
    afterItemRemoved: heading,
  });
  // The list refreshes after a dialog gave the focus back to a control the change replaced.
  useFocusAfterChange(files.data?.items.length ?? 0, () => heading.current);
  const snapshot = postSnapshot(post);
  const sent = new Set(snapshot?.review.versions.map((version) => version.id));
  const mark = (versionId: string) =>
    snapshot && sent.has(versionId) ? (
      <Badge tone="info">
        {snapshot.at === 'client'
          ? t('tasks.files.sentToClient')
          : t('tasks.files.inMedicalReview')}
      </Badge>
    ) : null;
  const items = files.data?.items ?? [];
  const fromTasks = post.media.filter((media) => media.task !== null);
  const canAdd = files.data?.rights.canAddDeliverable && items.length < POST_LIMITS.files;
  // Rule 3: the media changes only in `idea` and `in_production`.
  const locked =
    post.permissions.canEdit && isPostOpen(post.status) && !isPostContentEditable(post.status);

  return (
    <TaskSection
      title={t('content.media.title')}
      headingRef={heading}
      count={post.media.length > 0 ? formatNumber(post.media.length) : undefined}
      action={
        canAdd && (
          <Button ref={addButton} variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <PlusIcon />
            {t('content.media.add')}
          </Button>
        )
      }
    >
      {locked && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LockIcon aria-hidden="true" className="size-4 shrink-0" />
          {t('content.media.lockedHint')}
        </p>
      )}
      {files.isPending ? (
        <Skeleton className="h-24" />
      ) : files.isError ? (
        <LoadError message={t('tasks.files.loadError')} onRetry={() => files.refetch()} />
      ) : items.length === 0 && fromTasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('content.media.empty')}</p>
      ) : (
        <>
          {items.length > 0 && (
            <ul className="flex flex-col gap-3">
              {items.map((item) => (
                <FileItemCard
                  key={item.id}
                  item={item}
                  actions={actions}
                  versionMark={(version: FileVersion) => mark(version.id)}
                />
              ))}
            </ul>
          )}
          {fromTasks.length > 0 && (
            <TaskMedia media={fromTasks} mark={mark} divided={items.length > 0} />
          )}
        </>
      )}
      {adding && (
        <AddFilesDialog
          owner={owner}
          fileRole="deliverable"
          title={t('content.media.addTitle')}
          description={t('content.media.addBody')}
          withNote
          allowLink
          onClose={() => setAdding(false)}
          // The tenth file hides "add files": the heading takes the focus then.
          finalFocus={() =>
            (addButton.current?.isConnected ? addButton.current : heading.current) ?? true
          }
        />
      )}
      {dialogs}
    </TaskSection>
  );
}

/** The final files of the linked tasks, each under the task that produced it. */
function TaskMedia({
  media,
  mark,
  divided,
}: {
  media: PostMedia[];
  mark: (versionId: string) => ReactNode;
  /** The post's own files come before: a line sets the two groups apart. */
  divided: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn('flex flex-col gap-3', divided && 'border-t border-border pt-3')}>
      <h3 className="text-sm font-bold">{t('content.media.fromTasks')}</h3>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {media.map((version) => (
          <li
            key={version.id}
            className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-2"
          >
            <FileThumbnail version={version} className="aspect-4/3 w-full" />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 truncate text-sm font-medium" dir="auto">
                  {version.name}
                </span>
                <VersionBadge number={version.number} />
              </span>
              {version.task && (
                <Link
                  to="/tasks/$taskId"
                  params={{ taskId: version.task.id }}
                  className="truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  {t('content.media.ofTask', { task: version.task.title })}
                </Link>
              )}
              {mark(version.id)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
