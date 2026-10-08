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
  IconButton,
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
import { type ComponentProps, type ReactNode, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { FormAlert } from '../../components/form-alert';
import { ApiError } from '../../lib/api/client';
import { errorMessage, SCREEN_ERROR } from '../../lib/errors';
import { fromBusinessDateTimeInput, toBusinessDateTimeInput } from '../../lib/format';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { clientQuery } from '../clients/clients.queries';
import { focusTarget, type TaskFocus } from '../tasks/task-actions';
import { useChangePostStatus, useDuplicatePost, useUpdatePost } from './content.queries';
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

type ActionDialog = Target | 'details' | 'content' | 'duplicate' | 'published';

type FinalFocus = ComponentProps<typeof DialogContent>['finalFocus'];

/**
 * The header's actions (screen 4): the workflow moves the caller may make now, from the server's
 * `allowedTransitions`, then editing, duplicating, cancelling and archiving in a menu. The API
 * enforces every rule; a move that became stale answers `INVALID_TRANSITION` and the page
 * reloads (edge case 1). Every dialog stays mounted, so it fades out and gives the focus back: to
 * the button that opened it, or the control that replaced it (`focusTarget`, shared with the task
 * page, whose header has the same shape).
 */
export function PostActions({
  post,
  focus,
  onArchive,
}: {
  post: PostDetail;
  focus: TaskFocus;
  /** The confirmation lives on the page: the menu leaves with the archive. */
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  const change = useChangePostStatus(post.id);
  const [dialog, setDialog] = useState<ActionDialog | null>(null);
  const [medical, setMedical] = useState<MedicalDecision | null>(null);
  // The dialog's content stays while it fades out after closing.
  const shownDialog = useShownWhileClosing(dialog);
  const shownMedical = useShownWhileClosing(medical);
  // The button that opened a dialog; a menu item is gone once its menu closes.
  const opener = useRef<{ element: HTMLElement | null; fromMenu: boolean }>({
    element: null,
    fromMenu: false,
  });
  if (post.readOnly) return null;

  function open(next: ActionDialog, fromMenu = false) {
    opener.current = { element: document.activeElement as HTMLElement | null, fromMenu };
    setDialog(next);
  }
  function openMedical(decision: MedicalDecision) {
    opener.current = { element: document.activeElement as HTMLElement | null, fromMenu: false };
    setMedical(decision);
  }
  const finalFocus: FinalFocus = () => {
    const { element, fromMenu } = opener.current;
    if (!fromMenu && element?.isConnected && element !== document.body) return element;
    return focusTarget(focus, fromMenu ? 'menu' : 'move');
  };

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
      open(target);
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
    <div ref={focus.actions} className="flex shrink-0 flex-wrap items-center gap-2">
      {canMedicalReview && (
        <>
          <Button data-move onClick={() => openMedical('approve')}>
            <StethoscopeIcon />
            {t('tasks.medical.approve')}
          </Button>
          <Button data-move variant="outline" onClick={() => openMedical('return')}>
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
            data-move
            variant={BACKWARD.includes(target.move) ? 'outline' : 'primary'}
            disabled={change.isPending}
            // It may leave with the move: focusable, so the focus is not dropped meanwhile.
            focusableWhenDisabled
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
            render={
              <IconButton
                ref={focus.menu}
                variant="outline"
                size="icon"
                label={t('tasks.actions.more')}
              />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEditContent && (
              <DropdownMenuItem onClick={() => open('content', true)}>
                <PencilIcon />
                {t('content.actions.editContent')}
              </DropdownMenuItem>
            )}
            {editable && (
              <DropdownMenuItem onClick={() => open('details', true)}>
                <PencilIcon />
                {t('content.actions.editDetails')}
              </DropdownMenuItem>
            )}
            {canEdit && post.status === 'published' && (
              <DropdownMenuItem onClick={() => open('published', true)}>
                <PencilIcon />
                {t('content.actions.editPublished')}
              </DropdownMenuItem>
            )}
            {canEdit && (
              <DropdownMenuItem onClick={() => open('duplicate', true)}>
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
                  onClick={() => open(target, true)}
                >
                  <Icon />
                  {t(`content.moves.${target.move}`)}
                </DropdownMenuItem>
              );
            })}
            {canArchive && (
              <>
                {canEdit && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onClick={onArchive}>
                  <ArchiveIcon />
                  {t('content.actions.archive')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {typeof shownDialog === 'object' &&
        shownDialog !== null &&
        shownDialog.move !== 'publish' && (
          <MoveDialog
            key={shownDialog.move}
            post={post}
            target={shownDialog}
            open={dialog === shownDialog}
            onClose={() => setDialog(null)}
            finalFocus={finalFocus}
          />
        )}
      {shownMedical && (
        <PostMedicalReviewDialog
          key={shownMedical}
          post={post}
          decision={shownMedical}
          open={medical !== null}
          onClose={() => setMedical(null)}
          finalFocus={finalFocus}
        />
      )}
      <PublishedDialog
        post={post}
        publishing
        open={typeof dialog === 'object' && dialog?.move === 'publish'}
        onClose={() => setDialog(null)}
        finalFocus={finalFocus}
      />
      <PublishedDialog
        post={post}
        open={dialog === 'published'}
        onClose={() => setDialog(null)}
        finalFocus={finalFocus}
      />
      <ContentDialog
        post={post}
        open={dialog === 'content'}
        onClose={() => setDialog(null)}
        finalFocus={finalFocus}
      />
      <DetailsDialog
        post={post}
        open={dialog === 'details'}
        onClose={() => setDialog(null)}
        finalFocus={finalFocus}
      />
      <DuplicateDialog
        post={post}
        open={dialog === 'duplicate'}
        onClose={() => setDialog(null)}
        finalFocus={finalFocus}
      />
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
  open,
  onClose,
  finalFocus,
}: {
  post: PostDetail;
  target: Target;
  open: boolean;
  onClose: () => void;
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const ids = { note: useId(), reason: useId(), contact: useId() };
  const contactTrigger = useRef<HTMLButtonElement>(null);
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
    // Every missing field says so; the first one in the dialog takes the focus.
    const missingContact = needsContact && !values.contactId;
    const missingNote = needs === 'note' && !values.note;
    const missingReason = needs === 'reason' && !values.reason;
    if (missingContact) {
      form.setError('contactId', { type: SCREEN_ERROR, message: t('tasks.move.errors.contact') });
    }
    if (missingNote) {
      form.setError('note', { type: SCREEN_ERROR, message: t('tasks.move.errors.changes') });
    }
    if (missingReason) {
      form.setError('reason', { type: SCREEN_ERROR, message: t('tasks.move.errors.reason') });
    }
    if (missingContact) contactTrigger.current?.focus();
    else if (missingNote) form.setFocus('note');
    else if (missingReason) form.setFocus('reason');
    if (missingContact || missingNote || missingReason) return;
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
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      // After the exit animation, so the note does not empty while the dialog fades.
      onOpenChangeComplete={(next) => {
        if (next) return;
        form.reset();
        setFailure(null);
      }}
    >
      <DialogContent closeLabel={t('common.close')} finalFocus={finalFocus}>
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
                <SelectTrigger ref={contactTrigger} aria-labelledby={ids.contact}>
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
  open,
  onClose,
  finalFocus,
}: {
  post: PostDetail;
  publishing?: boolean;
  open: boolean;
  onClose: () => void;
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  // The form lives inside the content, which mounts on each opening: it starts from the post.
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} finalFocus={finalFocus}>
        <PublishedForm post={post} publishing={publishing} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function PublishedForm({
  post,
  publishing,
  onClose,
}: {
  post: PostDetail;
  publishing?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const atId = useId();
  const form = useRef<HTMLFormElement>(null);
  const change = useChangePostStatus(post.id);
  const update = useUpdatePost(post.id);
  const savedAt = toBusinessDateTimeInput(post.publishedAt ?? new Date());
  const savedUrls: Partial<Record<PostPlatform, string>> = Object.fromEntries(
    post.publishedLinks.map((link) => [link.platform, link.url]),
  );
  const [at, setAt] = useState(savedAt);
  const [urls, setUrls] = useState(savedUrls);
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
    if (wrong.length > 0 || late) {
      // The first wrong field takes the focus, as `handleSubmit` does on the other forms.
      const first = late ? `#${CSS.escape(atId)}` : `[data-link="${wrong[0]}"]`;
      form.current?.querySelector<HTMLElement>(first)?.focus();
      return;
    }
    const unchanged =
      at === savedAt &&
      post.platforms.every(
        (platform) => (urls[platform]?.trim() ?? '') === (savedUrls[platform] ?? ''),
      );
    // Correcting a published post without a change: nothing to send, and nothing to announce.
    if (!publishing && unchanged) {
      onClose();
      return;
    }
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
    <form
      ref={form}
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
        <FieldLabel htmlFor={atId}>{t('content.publishing.publishedAt')}</FieldLabel>
        <Input
          id={atId}
          type="datetime-local"
          dir="ltr"
          max={now}
          value={at}
          onChange={(event) => setAt(event.target.value)}
        />
        <FieldError match={atError}>{t('content.publishing.errors.publishedAt')}</FieldError>
      </Field>
      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-medium">
          {t('content.publishing.links')}
          <span className="ms-1 font-normal text-muted-foreground">({t('common.optional')})</span>
        </legend>
        {post.platforms.map((platform) => {
          const name = t(`clients.platforms.names.${platform}`);
          const bad = invalid.includes(platform);
          return (
            <Field key={platform} invalid={bad}>
              <div className="flex items-center gap-2">
                <PlatformMark platform={platform} size="sm" />
                <Input
                  data-link={platform}
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
    // Nothing changed: nothing to send, and nothing to announce.
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    try {
      await update.mutateAsync(changes);
      toast.add({ title: t('content.edit.saved'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(postFormFailure(form, t, error));
    }
  };
  return { failure, save };
}

interface EditDialogProps {
  post: PostDetail;
  open: boolean;
  onClose: () => void;
  finalFocus?: FinalFocus;
}

/**
 * A dialog of the post page around one form. The form mounts with the dialog's content, so each
 * opening starts from the post as it is, and the content stays while the dialog fades out.
 */
function PostDialog({
  open,
  onClose,
  finalFocus,
  wide,
  children,
}: Omit<EditDialogProps, 'post'> & { wide?: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        closeLabel={t('common.close')}
        className={wide ? 'max-w-2xl' : undefined}
        finalFocus={finalFocus}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
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
export function ContentDialog({ post, ...dialog }: EditDialogProps) {
  return (
    <PostDialog {...dialog} wide>
      <ContentForm post={post} onClose={dialog.onClose} />
    </PostDialog>
  );
}

function ContentForm({ post, onClose }: { post: PostDetail; onClose: () => void }) {
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
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>{t('content.edit.contentTitle')}</DialogTitle>
        <DialogDescription>{t('content.edit.contentBody')}</DialogDescription>
      </DialogHeader>
      <TypeField form={form} />
      <CaptionFields form={form} />
      <SaveFooter form={form} failure={failure} />
    </form>
  );
}

/**
 * The fields that stay free in every open status (rule 3): title, date, time, platforms,
 * responsible person, the client-approval flag, the counting line and the notes.
 */
export function DetailsDialog({ post, ...dialog }: EditDialogProps) {
  return (
    <PostDialog {...dialog} wide>
      <DetailsForm post={post} onClose={dialog.onClose} />
    </PostDialog>
  );
}

function DetailsForm({ post, onClose }: { post: PostDetail; onClose: () => void }) {
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
  );
}

/** Rule 4: a copy as a new idea of the same client, on the same date or another one. */
function DuplicateDialog({ post, ...dialog }: EditDialogProps) {
  return (
    <PostDialog {...dialog}>
      <DuplicateForm post={post} onClose={dialog.onClose} />
    </PostDialog>
  );
}

function DuplicateForm({ post, onClose }: { post: PostDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const duplicate = useDuplicatePost(post.id);
  const today = businessDate();
  const [date, setDate] = useState(post.publishDate < today ? today : post.publishDate);
  const [dateError, setDateError] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit() {
    setFailure(null);
    // A copy is never in the past (`INVALID_DATES`).
    const past = !date || date < today;
    setDateError(past);
    if (past) {
      field.current?.focus();
      return;
    }
    try {
      const copy = await duplicate.mutateAsync({ publishDate: date });
      toast.add({ title: t('content.duplicate.done'), type: 'success' });
      onClose();
      await navigate({ to: '/content/posts/$postId', params: { postId: copy.id } });
      // The page changed under the dialog: the copy's heading takes the focus.
      document.querySelector<HTMLElement>('[data-focus="heading"]')?.focus();
    } catch (error) {
      if (error instanceof ApiError && error.knownCode === 'INVALID_DATES') {
        setDateError(true);
        field.current?.focus();
        return;
      }
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
        <DialogTitle>{t('content.duplicate.title', { title: post.title })}</DialogTitle>
        <DialogDescription>{t('content.duplicate.body')}</DialogDescription>
      </DialogHeader>
      <Field invalid={dateError}>
        <FieldLabel htmlFor={id}>{t('content.form.publishDate')}</FieldLabel>
        <Input
          ref={field}
          id={id}
          type="date"
          dir="ltr"
          min={today}
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <FieldError match={dateError}>{t('content.form.errors.datePast')}</FieldError>
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
  );
}
