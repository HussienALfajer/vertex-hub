import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type FileVersion,
  isPostContentEditable,
  isPostOpen,
  MEDIA_LAYOUT_LIMIT,
  POST_LIMITS,
  type PostDetail,
  type PostMedia,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  IconButton,
  Input,
  Skeleton,
  toast,
} from '@vertex-hub/ui';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  ListOrderedIcon,
  LockIcon,
  PlusIcon,
} from 'lucide-react';
import { type ReactNode, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { useFocusAfterChange } from '../../lib/use-focus-after-change';
import { AddFilesDialog, useFileItemActions } from '../files/file-dialogs';
import { FileItemCard } from '../files/file-item-card';
import { FileThumbnail, VersionBadge } from '../files/file-parts';
import { type FileOwnerRef, fileItemsQuery } from '../files/files.queries';
import { TaskSection } from '../tasks/task-parts';
import { useUpdatePostLayout } from './content.queries';
import { postSnapshot } from './post-review';
import { moveItem } from './post-wizard-draft';
import { SlideWarnings } from './post-wizard-steps';

/*
 * The Slides section of the post page (spec F08B screen 4, rule A6; F08 rule 5): every medium of
 * the post in slide order, its own files and its linked tasks' finals together, each with its
 * caption and warnings; "Arrange" orders them and edits the captions. The post's own files keep
 * F10's controls below. While the post is with the medical reviewer or the client, the versions
 * of that snapshot say so.
 */

export function PostMediaSection({ post }: { post: PostDetail }) {
  const { t } = useTranslation();
  const owner: FileOwnerRef = { type: 'post', id: post.id };
  const files = useQuery(fileItemsQuery({ ownerType: 'post', ownerId: post.id }));
  const [adding, setAdding] = useState(false);
  const [arranging, setArranging] = useState(false);
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
  const canAdd = files.data?.rights.canAddDeliverable && items.length < POST_LIMITS.files;
  // Rule 3: the media changes only in `idea` and `in_production`.
  const locked =
    post.permissions.canEdit && isPostOpen(post.status) && !isPostContentEditable(post.status);

  return (
    <TaskSection
      title={t('content.slides.title')}
      headingRef={heading}
      count={post.media.length > 0 ? formatNumber(post.media.length) : undefined}
      action={
        <div className="flex flex-wrap gap-1">
          {post.permissions.canEditContent && post.media.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setArranging(true)}>
              <ListOrderedIcon />
              {t('content.slides.arrange')}
            </Button>
          )}
          {canAdd && (
            <Button ref={addButton} variant="ghost" size="sm" onClick={() => setAdding(true)}>
              <PlusIcon />
              {t('content.media.add')}
            </Button>
          )}
        </div>
      }
    >
      {locked && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LockIcon aria-hidden="true" className="size-4 shrink-0" />
          {t('content.media.lockedHint')}
        </p>
      )}
      {post.media.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('content.media.empty')}</p>
      ) : (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {post.media.map((medium, index) => (
            <Slide
              key={medium.id}
              medium={medium}
              index={index}
              mark={mark(medium.id)}
              warnings={
                <SlideWarnings checks={post.checks.filter((c) => c.mediaIndex === index)} />
              }
            />
          ))}
        </ol>
      )}
      {(items.length > 0 || files.isPending || files.isError) && (
        <Collapsible className="border-t border-border pt-3">
          <CollapsibleTrigger className="text-sm font-bold">
            {t('content.slides.ownFiles', { n: formatNumber(items.length) })}
          </CollapsibleTrigger>
          <CollapsiblePanel className="pt-3">
            {files.isPending ? (
              <Skeleton className="h-24" />
            ) : files.isError ? (
              <LoadError message={t('tasks.files.loadError')} onRetry={() => files.refetch()} />
            ) : (
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
          </CollapsiblePanel>
        </Collapsible>
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
          // The last file the post takes hides "add files": the heading takes the focus then.
          finalFocus={() =>
            (addButton.current?.isConnected ? addButton.current : heading.current) ?? true
          }
        />
      )}
      <ArrangeDialog post={post} open={arranging} onClose={() => setArranging(false)} />
      {dialogs}
    </TaskSection>
  );
}

/** One slide: its picture, number, name, where it comes from and its caption. */
function Slide({
  medium,
  index,
  mark,
  warnings,
}: {
  medium: PostMedia;
  index: number;
  mark: ReactNode;
  warnings: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-2">
      <div className="relative">
        <FileThumbnail version={medium} className="aspect-4/5 w-full" />
        <span className="absolute start-1.5 top-1.5 flex size-6 items-center justify-center rounded-sm bg-surface text-xs font-bold tabular-nums">
          {formatNumber(index + 1)}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-medium" dir="auto">
            {medium.name}
          </span>
          <VersionBadge number={medium.number} />
        </span>
        {medium.task && (
          <Link
            to="/tasks/$taskId"
            params={{ taskId: medium.task.id }}
            className="truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            {t('content.media.ofTask', { task: medium.task.title })}
          </Link>
        )}
        {medium.slideCaption && (
          <p className="text-xs" dir="auto">
            {medium.slideCaption}
          </p>
        )}
        {mark}
        {warnings}
      </div>
    </li>
  );
}

interface Arranged {
  fileItemId: string;
  name: string;
  medium: PostMedia;
  caption: string;
}

/** Rule A6: the slide order by drag or by the arrows, and a caption per slide. */
function ArrangeDialog({
  post,
  open,
  onClose,
}: {
  post: PostDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        {open && <ArrangeForm post={post} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ArrangeForm({ post, onClose }: { post: PostDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const save = useUpdatePostLayout(post.id);
  const [failure, setFailure] = useState<string | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const [slides, setSlides] = useState<Arranged[]>(() =>
    post.media.map((medium) => ({
      fileItemId: medium.fileItemId,
      name: medium.name,
      medium,
      caption: medium.slideCaption ?? '',
    })),
  );

  async function submit() {
    setFailure(null);
    try {
      await save.mutateAsync({
        // Edge case 15: the layout takes the first slides; the rest follow in F08 order.
        items: slides.slice(0, MEDIA_LAYOUT_LIMIT).map((slide) => ({
          fileItemId: slide.fileItemId,
          caption: slide.caption.trim() || null,
        })),
      });
      toast.add({ title: t('content.slides.saved'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('content.slides.arrangeTitle')}</DialogTitle>
        <DialogDescription>{t('content.slides.arrangeBody')}</DialogDescription>
      </DialogHeader>
      <ol className="flex flex-col gap-2">
        {slides.map((slide, index) => (
          <ArrangeRow
            key={slide.fileItemId}
            slide={slide}
            index={index}
            count={slides.length}
            dragging={dragged === index}
            onDragStart={() => setDragged(index)}
            onDrop={() => {
              if (dragged !== null) setSlides((current) => moveItem(current, dragged, index));
              setDragged(null);
            }}
            onDragEnd={() => setDragged(null)}
            onMove={(to) => setSlides((current) => moveItem(current, index, to))}
            onCaption={(caption) =>
              setSlides((current) =>
                current.map((item, i) => (i === index ? { ...item, caption } : item)),
              )
            }
          />
        ))}
      </ol>
      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ArrangeRow({
  slide,
  index,
  count,
  dragging,
  onDragStart,
  onDrop,
  onDragEnd,
  onMove,
  onCaption,
}: {
  slide: Arranged;
  index: number;
  count: number;
  dragging: boolean;
  onDragStart: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onMove: (to: number) => void;
  onCaption: (caption: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const name = t('content.slides.slide', { n: formatNumber(index + 1) });
  return (
    <li
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'flex flex-col gap-2 rounded-md border border-border bg-surface p-2 sm:flex-row sm:items-center',
        dragging && 'opacity-50',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <GripVerticalIcon
          aria-hidden="true"
          className="size-4 shrink-0 cursor-grab text-muted-foreground"
        />
        <span className="w-5 shrink-0 text-center text-sm font-bold tabular-nums">
          {formatNumber(index + 1)}
        </span>
        <FileThumbnail version={slide.medium} className="size-10" />
        <span className="min-w-0 truncate text-sm" dir="auto">
          {slide.name}
        </span>
      </div>
      <Field className="sm:w-64">
        <FieldLabel htmlFor={id} className="sr-only">
          {t('content.slides.captionOf', { name })}
        </FieldLabel>
        <Input
          id={id}
          dir="auto"
          maxLength={POST_LIMITS.slideCaption}
          placeholder={t('content.slides.captionPlaceholder')}
          value={slide.caption}
          onChange={(event) => onCaption(event.target.value)}
        />
      </Field>
      <div className="flex shrink-0">
        <IconButton
          label={t('content.slides.earlier', { name })}
          disabled={index === 0}
          onClick={() => onMove(index - 1)}
        >
          <ArrowUpIcon />
        </IconButton>
        <IconButton
          label={t('content.slides.later', { name })}
          disabled={index === count - 1}
          onClick={() => onMove(index + 1)}
        >
          <ArrowDownIcon />
        </IconButton>
      </div>
    </li>
  );
}
