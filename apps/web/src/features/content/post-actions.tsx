import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  businessDate,
  type CreatePost,
  type CreatePostInput,
  createPostSchema,
  isPostOpen,
  type PostDetail,
  type PostMove,
  type PostPlatform,
  type PostStatus,
  type PostStatusChange,
  type PostStatusChangeInput,
  type PublishedLink,
  postMove,
  postMoveNeeds,
  postStatusChangeSchema,
  publishedLinkSchema,
  type UpdatePost,
} from '@vertex-hub/contracts';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PlatformMark,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import {
  ArchiveIcon,
  BanIcon,
  CalendarCheckIcon,
  CalendarXIcon,
  CheckCheckIcon,
  CircleCheckBigIcon,
  CopyIcon,
  CornerUpLeftIcon,
  EllipsisIcon,
  EyeIcon,
  type LucideIcon,
  MegaphoneIcon,
  MessageSquareReplyIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  SendIcon,
  StethoscopeIcon,
  UndoIcon,
} from 'lucide-react';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { errorMessage, SCREEN_ERROR } from '../../lib/errors';
import { fromBusinessDateTimeInput, toBusinessDateTimeInput } from '../../lib/format';
import { clientQuery } from '../clients/clients.queries';
import {
  useArchivePost,
  useChangePostStatus,
  useDuplicatePost,
  useUpdatePost,
} from './content.queries';
import {
  ApprovalField,
  CaptionFields,
  CycleLineField,
  NotesField,
  PlatformsField,
  type PostFormMethods,
  PublishFields,
  postFormFailure,
  ResponsibleField,
  TitleField,
  TypeField,
} from './post-form';
import { type MedicalDecision, PostMedicalReviewDialog } from './post-review';

const MOVE_ICONS: Record<PostMove, LucideIcon> = {
  start: PlayIcon,
  submit: SendIcon,
  return: UndoIcon,
  send_to_client: EyeIcon,
  approve: CircleCheckBigIcon,
  withdraw: CornerUpLeftIcon,
  client_approved: CheckCheckIcon,
  client_changes: MessageSquareReplyIcon,
  schedule: CalendarCheckIcon,
  unschedule: CalendarXIcon,
  publish: MegaphoneIcon,
  reopen_content: RotateCcwIcon,
  cancel: BanIcon,
  reopen: RotateCcwIcon,
};

/** Icons that point along the reading direction, so they mirror in RTL (brand §6). */
const MIRRORED_ICONS: ReadonlySet<LucideIcon> = new Set([
  SendIcon,
  UndoIcon,
  CornerUpLeftIcon,
  MegaphoneIcon,
]);

/** Moves that send the post back rather than forward: shown as secondary buttons. */
const BACKWARD: PostMove[] = ['return', 'client_changes', 'withdraw', 'unschedule'];

/** Moves kept in the menu: they undo settled work. */
const MENU_MOVES: PostMove[] = ['reopen_content', 'cancel'];

/** Client responses recorded by hand (rule 24): the contact who answered is required. */
const RESPONSE_MOVES: PostMove[] = ['client_approved', 'client_changes'];

/** Internal passes (rule 11): they send the content token the reviewer was shown. */
const PASS_MOVES: PostMove[] = ['send_to_client', 'approve'];

interface Target {
  to: PostStatus;
  move: PostMove;
}

/** A move asks for input first: a note or reason, who answered, or when and where it went out. */
const needsDialog = ({ move }: Target): boolean =>
  postMoveNeeds(move) !== null ||
  RESPONSE_MOVES.includes(move) ||
  move === 'withdraw' ||
  move === 'publish';

/** What a finished move says: a healthcare client's pass waits for the medical review first. */
const moveDone = (t: TFunction, move: PostMove, post: Pick<PostDetail, 'reviewStage'>) =>
  PASS_MOVES.includes(move) && post.reviewStage === 'medical'
    ? t('content.moves.done.to_medical')
    : t(`content.moves.done.${move}`);

type Open = Target | 'details' | 'content' | 'duplicate' | 'archive' | 'published' | null;

/**
 * The header's actions (screen 4): the workflow moves the caller may make now, from the server's
 * `allowedTransitions`, then editing, duplicating, cancelling and archiving in a menu. The API
 * enforces every rule; a move that became stale answers `INVALID_TRANSITION` and the page
 * reloads (edge case 1).
 */
export function PostActions({ post }: { post: PostDetail }) {
  const { t } = useTranslation();
  const change = useChangePostStatus(post.id);
  const [open, setOpen] = useState<Open>(null);
  const [medical, setMedical] = useState<MedicalDecision | null>(null);
  if (post.readOnly) return null;

  const { canEdit, canEditContent, canArchive, canMedicalReview, canRecordResponse } =
    post.permissions;
  const targets = post.allowedTransitions.flatMap((to): Target[] => {
    const move = postMove(post.status, to);
    // Rule 24: a response is recorded only on a post cleared for the client (a healthcare
    // client's post needs its medical pass, `MEDICAL_REVIEW_REQUIRED`).
    if (!move || (RESPONSE_MOVES.includes(move) && !canRecordResponse)) return [];
    return [{ to, move }];
  });
  const buttons = targets.filter((target) => !MENU_MOVES.includes(target.move));
  const inMenu = targets.filter((target) => MENU_MOVES.includes(target.move));
  const editable = canEdit && isPostOpen(post.status);
  const menu = canEdit || canArchive;

  async function run(target: Target) {
    if (needsDialog(target)) {
      setOpen(target);
      return;
    }
    try {
      const moved = await change.mutateAsync({
        to: target.to,
        ...(PASS_MOVES.includes(target.move) && { contentToken: post.contentToken }),
      });
      toast.add({ title: moveDone(t, target.move, moved), type: 'success' });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {canMedicalReview && (
        <>
          <Button onClick={() => setMedical('approve')}>
            <StethoscopeIcon />
            {t('tasks.medical.approve')}
          </Button>
          <Button variant="outline" onClick={() => setMedical('return')}>
            <UndoIcon className="rtl:-scale-x-100" />
            {t('tasks.medical.return')}
          </Button>
        </>
      )}
      {buttons.map((target) => {
        const Icon = MOVE_ICONS[target.move];
        return (
          <Button
            key={target.to}
            variant={BACKWARD.includes(target.move) ? 'outline' : 'primary'}
            disabled={change.isPending}
            onClick={() => run(target)}
          >
            <Icon className={MIRRORED_ICONS.has(Icon) ? 'rtl:-scale-x-100' : undefined} />
            {t(`content.moves.${target.move}`)}
          </Button>
        );
      })}
      {menu && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="icon" aria-label={t('tasks.actions.more')} />}
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEditContent && (
              <DropdownMenuItem onClick={() => setOpen('content')}>
                <PencilIcon />
                {t('content.actions.editContent')}
              </DropdownMenuItem>
            )}
            {editable && (
              <DropdownMenuItem onClick={() => setOpen('details')}>
                <PencilIcon />
                {t('content.actions.editDetails')}
              </DropdownMenuItem>
            )}
            {canEdit && post.status === 'published' && (
              <DropdownMenuItem onClick={() => setOpen('published')}>
                <PencilIcon />
                {t('content.actions.editPublished')}
              </DropdownMenuItem>
            )}
            {canEdit && (
              <DropdownMenuItem onClick={() => setOpen('duplicate')}>
                <CopyIcon />
                {t('content.actions.duplicate')}
              </DropdownMenuItem>
            )}
            {inMenu.map((target) => {
              const Icon = MOVE_ICONS[target.move];
              return (
                <DropdownMenuItem
                  key={target.to}
                  variant={target.move === 'cancel' ? 'destructive' : undefined}
                  onClick={() => setOpen(target)}
                >
                  <Icon />
                  {t(`content.moves.${target.move}`)}
                </DropdownMenuItem>
              );
            })}
            {canArchive && (
              <>
                {canEdit && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onClick={() => setOpen('archive')}>
                  <ArchiveIcon />
                  {t('content.actions.archive')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {typeof open === 'object' &&
        open !== null &&
        (open.move === 'publish' ? (
          <PublishedDialog post={post} publishing onClose={() => setOpen(null)} />
        ) : (
          <MoveDialog post={post} target={open} onClose={() => setOpen(null)} />
        ))}
      {medical && (
        <PostMedicalReviewDialog post={post} decision={medical} onClose={() => setMedical(null)} />
      )}
      {open === 'content' && <ContentDialog post={post} onClose={() => setOpen(null)} />}
      {open === 'details' && <DetailsDialog post={post} onClose={() => setOpen(null)} />}
      {open === 'published' && <PublishedDialog post={post} onClose={() => setOpen(null)} />}
      {open === 'duplicate' && <DuplicateDialog post={post} onClose={() => setOpen(null)} />}
      <ArchiveDialog post={post} open={open === 'archive'} onClose={() => setOpen(null)} />
    </div>
  );
}

/**
 * The input a move needs: what must change (returns and client changes), a reason (cancel,
 * reopen content), who answered for the client, or an optional note when withdrawing.
 */
function MoveDialog({
  post,
  target,
  onClose,
}: {
  post: PostDetail;
  target: Target;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ids = { note: useId(), reason: useId(), contact: useId() };
  const change = useChangePostStatus(post.id);
  const [failure, setFailure] = useState<string | null>(null);
  const { move } = target;
  const needs = postMoveNeeds(move);
  const optionalNote = move === 'withdraw';
  const needsContact = RESPONSE_MOVES.includes(move);
  const client = useQuery({ ...clientQuery(post.client.id), enabled: needsContact });
  // Rule 24: any contact may have answered; those with final approval are suggested first.
  const contacts = [...(client.data?.contacts ?? [])].sort(
    (a, b) => Number(b.hasFinalApproval) - Number(a.hasFinalApproval),
  );
  const contactItems = contacts.map((contact) => ({
    value: contact.id,
    label: contact.hasFinalApproval
      ? t('tasks.move.finalApprover', { name: contact.name })
      : contact.name,
  }));

  const form = useForm<PostStatusChangeInput, unknown, PostStatusChange>({
    resolver: standardSchemaResolver(postStatusChangeSchema),
    defaultValues: { to: target.to, note: '', reason: '' },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (needs === 'note' && !values.note) {
      form.setError('note', { type: SCREEN_ERROR, message: t('tasks.move.errors.changes') });
      return;
    }
    if (needs === 'reason' && !values.reason) {
      form.setError('reason', { type: SCREEN_ERROR, message: t('tasks.move.errors.reason') });
      return;
    }
    if (needsContact && !values.contactId) {
      form.setError('contactId', { type: SCREEN_ERROR, message: t('tasks.move.errors.contact') });
      return;
    }
    try {
      const moved = await change.mutateAsync({
        to: target.to,
        note: needs === 'note' || optionalNote ? values.note || undefined : undefined,
        reason: needs === 'reason' ? (values.reason ?? undefined) : undefined,
        contactId: needsContact ? values.contactId : undefined,
      });
      toast.add({ title: moveDone(t, move, moved), type: 'success' });
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
            <DialogTitle>{t(`content.move.${move}.title`, { title: post.title })}</DialogTitle>
            <DialogDescription>{t(`content.move.${move}.body`)}</DialogDescription>
          </DialogHeader>
          {needsContact && (
            <Field invalid={!!errors.contactId}>
              <FieldLabel id={ids.contact} render={<span />}>
                {t('tasks.move.responder')}
              </FieldLabel>
              <Select
                items={contactItems}
                value={form.watch('contactId') ?? null}
                onValueChange={(next) => {
                  form.setValue('contactId', next ?? undefined);
                  form.clearErrors('contactId');
                }}
              >
                <SelectTrigger aria-labelledby={ids.contact}>
                  <SelectValue placeholder={t('content.move.contactPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {contactItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {client.isSuccess && contacts.length === 0 && (
                <FieldDescription>{t('tasks.move.noContacts')}</FieldDescription>
              )}
              <FieldError match={!!errors.contactId}>{t('tasks.move.errors.contact')}</FieldError>
            </Field>
          )}
          {needs === 'note' && (
            <Field invalid={!!errors.note}>
              <FieldLabel htmlFor={ids.note}>{t('tasks.move.changes')}</FieldLabel>
              <Textarea
                id={ids.note}
                rows={3}
                placeholder={t('content.move.changesPlaceholder')}
                {...form.register('note')}
              />
              <FieldError match={!!errors.note}>{t('tasks.move.errors.changes')}</FieldError>
            </Field>
          )}
          {optionalNote && (
            <Field invalid={!!errors.note}>
              <FieldLabel htmlFor={ids.note}>{t('tasks.move.optionalNote')}</FieldLabel>
              <Textarea id={ids.note} rows={2} {...form.register('note')} />
              <FieldError match={!!errors.note}>{t('tasks.move.errors.changes')}</FieldError>
            </Field>
          )}
          {needs === 'reason' && (
            <Field invalid={!!errors.reason}>
              <FieldLabel htmlFor={ids.reason}>{t('tasks.move.reason')}</FieldLabel>
              <Textarea
                id={ids.reason}
                rows={2}
                placeholder={t('tasks.move.reasonPlaceholder')}
                {...form.register('reason')}
              />
              <FieldError match={!!errors.reason}>{t('tasks.move.errors.reason')}</FieldError>
            </Field>
          )}
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button
              type="submit"
              variant={move === 'cancel' ? 'destructive' : 'primary'}
              disabled={form.formState.isSubmitting}
            >
              {t(`content.moves.${move}`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * When the post went out and where (rule 18): marking it published (`publishing`), or correcting
 * the time and the links afterwards (rule 3). One optional link per platform of the post.
 */
export function PublishedDialog({
  post,
  publishing,
  onClose,
}: {
  post: PostDetail;
  publishing?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ids = { at: useId(), links: useId() };
  const change = useChangePostStatus(post.id);
  const update = useUpdatePost(post.id);
  const [at, setAt] = useState(toBusinessDateTimeInput(post.publishedAt ?? new Date()));
  const [urls, setUrls] = useState<Partial<Record<PostPlatform, string>>>(
    Object.fromEntries(post.publishedLinks.map((link) => [link.platform, link.url])),
  );
  const [invalid, setInvalid] = useState<PostPlatform[]>([]);
  const [atError, setAtError] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const now = toBusinessDateTimeInput(new Date());
  const pending = change.isPending || update.isPending;

  async function submit() {
    setFailure(null);
    const links: PublishedLink[] = [];
    const wrong: PostPlatform[] = [];
    for (const platform of post.platforms) {
      const url = urls[platform]?.trim();
      if (!url) continue;
      const parsed = publishedLinkSchema.safeParse({ platform, url });
      if (parsed.success) links.push(parsed.data);
      else wrong.push(platform);
    }
    // Not in the future (rule 18).
    const late = !at || at > now;
    setInvalid(wrong);
    setAtError(late);
    if (wrong.length > 0 || late) return;
    const publishedAt = fromBusinessDateTimeInput(at);
    try {
      if (publishing) {
        await change.mutateAsync({ to: 'published', publishedAt, publishedLinks: links });
        toast.add({ title: t('content.moves.done.publish'), type: 'success' });
      } else {
        await update.mutateAsync({ publishedAt, publishedLinks: links });
        toast.add({ title: t('content.publishing.saved'), type: 'success' });
      }
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <form
          className="grid gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {publishing
                ? t('content.move.publish.title', { title: post.title })
                : t('content.publishing.editTitle')}
            </DialogTitle>
            <DialogDescription>
              {publishing
                ? post.linkedTasks.length > 0
                  ? t('content.move.publish.bodyWithTasks')
                  : t('content.move.publish.body')
                : t('content.publishing.editBody')}
            </DialogDescription>
          </DialogHeader>
          <Field invalid={atError}>
            <FieldLabel htmlFor={ids.at}>{t('content.publishing.publishedAt')}</FieldLabel>
            <Input
              id={ids.at}
              type="datetime-local"
              max={now}
              value={at}
              onChange={(event) => setAt(event.target.value)}
            />
            <FieldError match={atError}>{t('content.publishing.errors.publishedAt')}</FieldError>
          </Field>
          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm font-medium">
              {t('content.publishing.links')}
              <span className="ms-1 font-normal text-muted-foreground">
                ({t('common.optional')})
              </span>
            </legend>
            {post.platforms.map((platform) => {
              const name = t(`clients.platforms.names.${platform}`);
              const bad = invalid.includes(platform);
              return (
                <Field key={platform} invalid={bad}>
                  <div className="flex items-center gap-2">
                    <PlatformMark platform={platform} size="sm" />
                    <Input
                      type="url"
                      dir="ltr"
                      inputMode="url"
                      aria-label={t('content.publishing.linkOn', { platform: name })}
                      placeholder={t('content.publishing.linkOn', { platform: name })}
                      value={urls[platform] ?? ''}
                      onChange={(event) => setUrls({ ...urls, [platform]: event.target.value })}
                    />
                  </div>
                  <FieldError match={bad}>{t('content.publishing.errors.link')}</FieldError>
                </Field>
              );
            })}
          </fieldset>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {publishing ? t('content.moves.publish') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The post as the shared form reads it; an edit sends only the fields that changed. */
function usePostForm(post: PostDetail): PostFormMethods {
  return useForm<CreatePostInput, unknown, CreatePost>({
    resolver: standardSchemaResolver(createPostSchema),
    defaultValues: {
      clientId: post.client.id,
      title: post.title,
      type: post.type,
      platforms: post.platforms,
      publishDate: post.publishDate,
      publishTime: post.publishTime,
      caption: post.caption ?? '',
      hashtags: post.hashtags ?? '',
      notes: post.notes ?? '',
      needsClientApproval: post.needsClientApproval,
      responsibleId: post.responsible.id,
      cycleLineId: post.cycleLine?.id ?? null,
    },
  });
}

function useSavePost(post: PostDetail, form: PostFormMethods, onClose: () => void) {
  const { t } = useTranslation();
  const update = useUpdatePost(post.id);
  const [failure, setFailure] = useState<string | null>(null);
  const save = async (changes: UpdatePost) => {
    setFailure(null);
    try {
      if (Object.keys(changes).length > 0) await update.mutateAsync(changes);
      toast.add({ title: t('content.edit.saved'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(postFormFailure(form, t, error));
    }
  };
  return { failure, save };
}

function SaveFooter({ form, failure }: { form: PostFormMethods; failure: string | null }) {
  const { t } = useTranslation();
  return (
    <>
      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('common.saving') : t('common.save')}
        </Button>
      </DialogFooter>
    </>
  );
}

/** The type, caption and hashtags: what the review and the client approve (rule 3). */
export function ContentDialog({ post, onClose }: { post: PostDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const form = usePostForm(post);
  const { failure, save } = useSavePost(post, form, onClose);
  const submit = form.handleSubmit((values) => {
    const dirty = form.formState.dirtyFields;
    return save({
      ...(dirty.type && { type: values.type }),
      ...(dirty.caption && { caption: values.caption ?? null }),
      ...(dirty.hashtags && { hashtags: values.hashtags ?? null }),
    });
  });
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('content.edit.contentTitle')}</DialogTitle>
            <DialogDescription>{t('content.edit.contentBody')}</DialogDescription>
          </DialogHeader>
          <TypeField form={form} />
          <CaptionFields form={form} />
          <SaveFooter form={form} failure={failure} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The fields that stay free in every open status (rule 3): title, date, time, platforms,
 * responsible person, the client-approval flag, the counting line and the notes.
 */
export function DetailsDialog({ post, onClose }: { post: PostDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const form = usePostForm(post);
  const { failure, save } = useSavePost(post, form, onClose);
  const submit = form.handleSubmit((values) => {
    const dirty = form.formState.dirtyFields;
    return save({
      ...(dirty.title && { title: values.title }),
      ...(dirty.platforms && { platforms: values.platforms }),
      ...(dirty.publishDate && { publishDate: values.publishDate }),
      ...(dirty.publishTime && { publishTime: values.publishTime ?? null }),
      ...(dirty.notes && { notes: values.notes ?? null }),
      ...(dirty.needsClientApproval && { needsClientApproval: values.needsClientApproval }),
      ...(dirty.responsibleId && { responsibleId: values.responsibleId }),
      ...(dirty.cycleLineId && { cycleLineId: values.cycleLineId }),
    });
  });
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('content.edit.detailsTitle')}</DialogTitle>
            <DialogDescription>{t('content.edit.detailsBody')}</DialogDescription>
          </DialogHeader>
          <TitleField form={form} />
          <PublishFields form={form} allowPast />
          <PlatformsField form={form} />
          <ResponsibleField form={form} current={post.responsible} />
          <CycleLineField form={form} current={post.cycleLine} />
          <NotesField form={form} />
          <ApprovalField form={form} />
          <SaveFooter form={form} failure={failure} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Rule 4: a copy as a new idea of the same client, on the same date or another one. */
function DuplicateDialog({ post, onClose }: { post: PostDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const navigate = useNavigate();
  const duplicate = useDuplicatePost(post.id);
  const today = businessDate();
  const [date, setDate] = useState(post.publishDate < today ? today : post.publishDate);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit() {
    setFailure(null);
    try {
      const copy = await duplicate.mutateAsync({ publishDate: date });
      toast.add({ title: t('content.duplicate.done'), type: 'success' });
      onClose();
      await navigate({ to: '/content/posts/$postId', params: { postId: copy.id } });
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <form
          className="grid gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('content.duplicate.title', { title: post.title })}</DialogTitle>
            <DialogDescription>{t('content.duplicate.body')}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={id}>{t('content.form.publishDate')}</FieldLabel>
            <Input
              id={id}
              type="date"
              min={today}
              required
              value={date}
              onChange={(event) => setDate(event.target.value || today)}
            />
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={duplicate.isPending}>
              {t('content.actions.duplicate')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveDialog({
  post,
  open,
  onClose,
}: {
  post: PostDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const archive = useArchivePost(post.id);
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t('content.archive.title', { title: post.title })}
      body={t('content.archive.body')}
      action={t('content.actions.archive')}
      destructive
      pending={archive.isPending}
      onConfirm={async () => {
        await archive.mutateAsync(undefined);
        toast.add({ title: t('content.archive.done'), type: 'success' });
      }}
    />
  );
}
