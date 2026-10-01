import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import {
  type ClientDecision,
  type PublicApproval,
  type PublicApprovalFile,
  type PublicApprovalItem,
  type PublicApproveAll,
  type PublicApproveAllInput,
  type PublicResponse,
  type PublicResponseInput,
  publicApproveAllSchema,
  publicResponseSchema,
} from '@vertex-hub/contracts';
import {
  AscentBar,
  Badge,
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  Skeleton,
  Textarea,
  VertexLogo,
} from '@vertex-hub/ui';
import {
  CheckCheckIcon,
  CircleCheckBigIcon,
  ClockAlertIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LinkIcon,
  MessageSquareReplyIcon,
  Undo2Icon,
} from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { errorMessage, SCREEN_ERROR } from '../../lib/errors';
import { formatDateTime, formatFileSize, formatNumber } from '../../lib/format';
import { formatPublish, POST_TYPE_ICONS, PostPlatforms } from '../content/post-parts';
import { FileTypeIcon } from '../files/file-parts';
import {
  publicApprovalQuery,
  publicVersionUrl,
  useApproveAllPosts,
  useRespondToApproval,
} from './approvals.queries';

/*
 * The client page (spec F09, screen 4, rules 20–23; F08 screen 7, rules 23 and 27): what the
 * holder of an approval link sees, with no account and outside the app shell. Task items first,
 * then the posts under "Content plan" in publish order. Phone width first: most clients open it
 * from WhatsApp. View only: a download is offered only for files the browser cannot show
 * (rule 22).
 */

export function PublicApprovalPage({ token }: { token: string }) {
  const { t } = useTranslation();
  const approval = useQuery(publicApprovalQuery(token));
  const status = approval.error instanceof ApiError ? approval.error.status : null;
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="bg-sidebar px-4 py-4">
        <div className="mx-auto flex w-full max-w-2xl items-center">
          <VertexLogo label={t('app.brand')} className="w-24 text-sidebar-marker" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6">
        {approval.isPending ? (
          <>
            <Skeleton className="h-36" />
            <Skeleton className="h-64" />
          </>
        ) : approval.isError ? (
          status === 410 ? (
            <LinkMessage
              icon={<ClockAlertIcon />}
              title={t('approvals.public.expiredTitle')}
              body={t('errors.APPROVAL_LINK_EXPIRED')}
            />
          ) : status === 404 || status === 400 ? (
            // Rule 20: never which case of "not valid" applies.
            <LinkMessage
              icon={<LinkIcon />}
              title={t('approvals.public.invalidTitle')}
              body={t('approvals.public.invalidBody')}
            />
          ) : (
            <LoadError
              message={t('approvals.public.loadError')}
              onRetry={() => approval.refetch()}
            />
          )
        ) : (
          <ApprovalView token={token} approval={approval.data} />
        )}
      </main>
    </div>
  );
}

function LinkMessage({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return <EmptyState role="alert" icon={icon} title={title} description={body} />;
}

function ApprovalView({ token, approval }: { token: string; approval: PublicApproval }) {
  const { t } = useTranslation();
  const planId = useId();
  const [approvingAll, setApprovingAll] = useState(false);
  const tasks = approval.items.filter((item) => item.kind === 'task');
  const posts = approval.items.filter((item) => item.kind === 'post');
  const pendingPosts = posts.filter((item) => item.status === 'pending');
  return (
    <>
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <p className="text-sm text-muted-foreground">{approval.clientName}</p>
        <div className="flex items-center gap-3">
          <AscentBar />
          <h1 className="text-xl font-bold">
            {t('approvals.public.greeting', { name: approval.contactName })}
          </h1>
        </div>
        <p>{t('approvals.public.intro', { manager: approval.accountManagerName })}</p>
        {approval.message && (
          <p className="rounded-md bg-muted px-3 py-2 whitespace-pre-line" dir="auto">
            {approval.message}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {t('approvals.public.validUntil', { date: formatDateTime(approval.expiresAt) })}
        </p>
      </section>
      {tasks.length > 0 && (
        <ol className="flex flex-col gap-4">
          {tasks.map((item) => (
            <ItemCard key={item.id} token={token} item={item} />
          ))}
        </ol>
      )}
      {posts.length > 0 && (
        <section aria-labelledby={planId} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <h2 id={planId} className="text-lg font-bold">
              {t('approvals.public.contentPlan')}
            </h2>
            {pendingPosts.length > 1 && (
              <Button className="ms-auto" onClick={() => setApprovingAll(true)}>
                <CheckCheckIcon />
                {t('approvals.public.approveAll', { n: formatNumber(pendingPosts.length) })}
              </Button>
            )}
          </div>
          <ol className="flex flex-col gap-4">
            {posts.map((item) => (
              <ItemCard key={item.id} token={token} item={item} />
            ))}
          </ol>
        </section>
      )}
      {approvingAll && (
        <ApproveAllDialog
          token={token}
          count={pendingPosts.length}
          onClose={() => setApprovingAll(false)}
        />
      )}
    </>
  );
}

/**
 * One task or post. A post shows its date and time, type and platforms first, its media as a
 * strip to swipe through, then the caption and hashtags (F08 rule 27).
 */
function ItemCard({ token, item }: { token: string; item: PublicApprovalItem }) {
  const { t } = useTranslation();
  const [deciding, setDeciding] = useState<ClientDecision | null>(null);
  const [previewing, setPreviewing] = useState<PublicApprovalFile | null>(null);
  const { post } = item;
  // The files of a post carry no name (rule 27): they are numbered instead.
  const files = item.files.map((file, index) =>
    file.name
      ? file
      : { ...file, name: t('approvals.public.media', { n: formatNumber(index + 1) }) },
  );
  const strip = post !== null && files.length > 1;
  const Icon = post ? POST_TYPE_ICONS[post.type] : null;
  // Posts sit under the "Content plan" heading.
  const Heading = item.kind === 'post' ? 'h3' : 'h2';
  return (
    <li className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-col gap-2">
        {post && Icon && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{formatPublish(post)}</span>
            <span className="flex items-center gap-1">
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              {t(`content.types.${post.type}`)}
            </span>
            <PostPlatforms platforms={post.platforms} size="sm" />
          </div>
        )}
        <Heading className="text-lg font-bold" dir="auto">
          {item.title}
        </Heading>
      </div>
      {item.text && (
        <p className="whitespace-pre-line" dir="auto">
          {item.text}
        </p>
      )}
      {files.length > 0 && (
        <ul
          aria-label={strip ? t('approvals.public.mediaStrip') : undefined}
          className={
            strip
              ? '-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2'
              : post
                ? 'grid grid-cols-1 gap-3'
                : 'grid grid-cols-2 gap-3 sm:grid-cols-3'
          }
        >
          {files.map((file) => (
            <FileTile
              key={file.versionId}
              token={token}
              file={file}
              showName={post === null}
              className={strip ? 'w-4/5 shrink-0 snap-start sm:w-1/2' : undefined}
              onPreview={() => setPreviewing(file)}
            />
          ))}
        </ul>
      )}
      {post?.caption && (
        <p className="whitespace-pre-line" dir="auto">
          {post.caption}
        </p>
      )}
      {post?.hashtags && (
        <p className="text-sm text-muted-foreground" dir="auto">
          {post.hashtags}
        </p>
      )}
      {item.status === 'pending' ? (
        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row">
          <Button size="lg" className="sm:flex-1" onClick={() => setDeciding('approved')}>
            <CircleCheckBigIcon />
            {t('approvals.public.approve')}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="sm:flex-1"
            onClick={() => setDeciding('changes_requested')}
          >
            <MessageSquareReplyIcon />
            {t('approvals.public.requestChanges')}
          </Button>
        </div>
      ) : (
        <Outcome item={item} />
      )}
      {deciding && (
        <DecisionDialog
          token={token}
          item={item}
          decision={deciding}
          onClose={() => setDeciding(null)}
        />
      )}
      {previewing && (
        <PreviewDialog token={token} file={previewing} onClose={() => setPreviewing(null)} />
      )}
    </li>
  );
}

/** A decided or withdrawn item: the result, final (rule 15), with its time and note. */
function Outcome({ item }: { item: PublicApprovalItem }) {
  const { t } = useTranslation();
  if (item.status === 'withdrawn') {
    return (
      <p className="flex items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
        <Undo2Icon aria-hidden="true" className="size-4 shrink-0" />
        {t('approvals.public.withdrawn')}
      </p>
    );
  }
  const approved = item.status === 'approved';
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={approved ? 'success' : 'warning'}>
          {approved ? <CheckCheckIcon aria-hidden="true" /> : null}
          {t(`approvals.public.decided.${approved ? 'approved' : 'changes_requested'}`)}
        </Badge>
        {item.decidedAt && (
          <span className="text-muted-foreground tabular-nums">
            {formatDateTime(item.decidedAt)}
          </span>
        )}
      </div>
      {item.note && (
        <p className="whitespace-pre-line" dir="auto">
          {item.note}
        </p>
      )}
      {item.recordedByAgency && (
        <p className="text-muted-foreground">{t('approvals.public.recordedByAgency')}</p>
      )}
    </div>
  );
}

/**
 * A file of the snapshot (rule 22): what the browser shows opens in the page, a link opens its
 * site, and anything else is offered as a download with its name and size.
 */
function FileTile({
  token,
  file,
  showName = true,
  className,
  onPreview,
}: {
  token: string;
  file: PublicApprovalFile;
  /** Post media is shown without names. */
  showName?: boolean;
  className?: string;
  onPreview: () => void;
}) {
  const { t } = useTranslation();
  const frame =
    'flex aspect-4/3 w-full items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground';
  const picture = file.previewAvailable ? (
    <img
      src={publicVersionUrl(token, file.versionId, 'thumbnail')}
      alt=""
      loading="lazy"
      className="size-full object-cover"
    />
  ) : (
    <FileTypeIcon type={file.type} className="size-8" />
  );
  const name = showName && (
    <span className="truncate text-sm" dir="auto" title={file.name}>
      {file.name}
    </span>
  );
  // An image the browser cannot show itself (TIFF) still has its rendered preview.
  if (file.display === 'inline' || (file.type === 'image' && file.previewAvailable)) {
    return (
      <li className={cn('flex min-w-0 flex-col gap-1.5', className)}>
        <button
          type="button"
          className={`${frame} focus-visible:outline-2 focus-visible:outline-ring`}
          aria-label={t('files.previewNamed', { name: file.name })}
          onClick={onPreview}
        >
          {picture}
        </button>
        {name}
      </li>
    );
  }
  const link = file.display === 'link';
  return (
    <li className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className={frame}>{picture}</span>
      {name}
      {!link && file.sizeBytes !== null && (
        <span className="text-xs text-muted-foreground">{formatFileSize(file.sizeBytes)}</span>
      )}
      {link ? (
        <Button
          variant="outline"
          size="sm"
          render={<a href={file.linkUrl ?? ''} target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLinkIcon />
          {file.linkLabel ?? t('files.openLink')}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          render={<a href={publicVersionUrl(token, file.versionId, 'content')} download />}
        >
          <DownloadIcon />
          {t('files.download')}
        </Button>
      )}
    </li>
  );
}

/** The file in the page: an image's rendered preview, the browser's PDF viewer, or a player. */
function PreviewDialog({
  token,
  file,
  onClose,
}: {
  token: string;
  file: PublicApprovalFile;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const content = publicVersionUrl(token, file.versionId, 'content');
  // Some phones show no PDF inside a page: the original opens in their own viewer.
  const openOriginal = (
    <Button
      variant="outline"
      size="sm"
      render={<a href={content} target="_blank" rel="noopener noreferrer" />}
    >
      <ExternalLinkIcon />
      {t('files.preview.openOriginal')}
    </Button>
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        closeLabel={t('common.close')}
        className="flex h-[calc(100dvh-2rem)] max-w-4xl flex-col gap-3 p-4"
      >
        <DialogTitle className="min-w-0 truncate pe-10 text-base" dir="auto">
          {file.name}
        </DialogTitle>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-hidden rounded-lg bg-muted p-2">
          {file.type === 'image' ? (
            <img
              src={
                file.previewAvailable ? publicVersionUrl(token, file.versionId, 'preview') : content
              }
              alt={file.name}
              className="min-h-0 max-w-full flex-1 object-contain"
            />
          ) : file.type === 'video' ? (
            // biome-ignore lint/a11y/useMediaCaption: client work files have no captions to offer
            <video src={content} controls preload="metadata" className="max-h-full max-w-full" />
          ) : file.type === 'pdf' ? (
            <>
              <iframe
                src={content}
                title={file.name}
                className="min-h-0 w-full flex-1 border-0 bg-surface"
              />
              {openOriginal}
            </>
          ) : (
            <>
              <FileTypeIcon type={file.type} className="size-12 text-muted-foreground" />
              {openOriginal}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The decision on one item. It is final (rule 15), so approving says so first; asking for
 * changes needs a note (rule 14).
 */
function DecisionDialog({
  token,
  item,
  decision,
  onClose,
}: {
  token: string;
  item: PublicApprovalItem;
  decision: ClientDecision;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const respond = useRespondToApproval(token);
  const [failure, setFailure] = useState<string | null>(null);
  const approving = decision === 'approved';
  const form = useForm<PublicResponseInput, unknown, PublicResponse>({
    resolver: standardSchemaResolver(publicResponseSchema),
    defaultValues: { decision, note: '' },
  });
  const noteError = form.formState.errors.note;
  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (!approving && !values.note) {
      form.setError('note', { type: SCREEN_ERROR, message: t('approvals.public.errors.note') });
      return;
    }
    try {
      await respond.mutateAsync({ itemId: item.id, decision, note: values.note || undefined });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle className="pe-8">
              {t(approving ? 'approvals.public.approveTitle' : 'approvals.public.changesTitle', {
                title: item.title,
              })}
            </DialogTitle>
            <DialogDescription>
              {t(approving ? 'approvals.public.approveBody' : 'approvals.public.changesBody')}
            </DialogDescription>
          </DialogHeader>
          <Field invalid={!!noteError}>
            <FieldLabel htmlFor={id}>
              {approving ? t('approvals.public.note') : t('approvals.public.changes')}
            </FieldLabel>
            <Textarea
              id={id}
              rows={approving ? 2 : 4}
              dir="auto"
              placeholder={approving ? undefined : t('approvals.public.changesPlaceholder')}
              {...form.register('note')}
            />
            <FieldError match={!!noteError}>{t('approvals.public.errors.note')}</FieldError>
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {approving ? t('approvals.public.confirmApprove') : t('approvals.public.sendChanges')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Approve all" (F08 rule 23): every pending post of the link at once, with one optional note.
 * Final like each decision, so the count is confirmed first; tasks are never included.
 */
function ApproveAllDialog({
  token,
  count,
  onClose,
}: {
  token: string;
  count: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const approveAll = useApproveAllPosts(token);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<PublicApproveAllInput, unknown, PublicApproveAll>({
    resolver: standardSchemaResolver(publicApproveAllSchema),
    defaultValues: { note: '' },
  });
  const noteError = form.formState.errors.note;
  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await approveAll.mutateAsync({ note: values.note || undefined });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle className="pe-8">
              {t('approvals.public.approveAllTitle', { n: formatNumber(count) })}
            </DialogTitle>
            <DialogDescription>{t('approvals.public.approveAllBody')}</DialogDescription>
          </DialogHeader>
          <Field invalid={!!noteError}>
            <FieldLabel htmlFor={id}>{t('approvals.public.note')}</FieldLabel>
            <Textarea id={id} rows={2} dir="auto" {...form.register('note')} />
            <FieldError match={!!noteError}>
              {t('approvals.public.errors.approveAllNote')}
            </FieldError>
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('approvals.public.confirmApproveAll')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
