import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  APPROVAL_LIMITS,
  type CreateApprovalRequest,
  type CreateApprovalRequestInput,
  createApprovalRequestSchema,
  type EmailSummary,
  type IssuedApprovalRequest,
  type ReadyClient,
  type ReadyPost,
  type ReadyTask,
} from '@vertex-hub/contracts';
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@vertex-hub/ui';
import { type ComponentProps, useEffect, useId, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { ApiError } from '../../lib/api/client';
import { errorMessage, errorRole, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { useFocusFirstError } from '../../lib/focus-first-invalid';
import { formatDateTime, formatNumber, isolateLtr } from '../../lib/format';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { clientQuery } from '../clients/clients.queries';
import { PostFacts, PostThumbnail } from '../content/post-parts';
import { IssuedLink, ItemKindBadge } from './approval-parts';
import { useCreateApprovalRequest } from './approvals.queries';

/** What a ready task would send: its snapshot's files and whether it has a text (rule 2). */
export function SnapshotSummary({ snapshot }: { snapshot: ReadyTask['snapshot'] }) {
  const { t } = useTranslation();
  const parts = [
    snapshot.files > 0 && t('approvals.ready.files', { n: formatNumber(snapshot.files) }),
    snapshot.hasText && t('approvals.ready.text'),
  ].filter(Boolean);
  return <>{parts.join(' · ')}</>;
}

/**
 * What a ready post would send (F08 rule 27): its type, date and platforms, the media of its
 * snapshot and the start of its caption.
 */
export function PostSnapshotSummary({ post }: { post: ReadyPost }) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 items-start gap-2">
      {post.snapshot.thumbnailVersionId && (
        <PostThumbnail versionId={post.snapshot.thumbnailVersionId} className="size-10" />
      )}
      <span className="flex min-w-0 flex-col gap-0.5">
        <PostFacts post={post} />
        <span className="line-clamp-2 text-xs text-muted-foreground">
          {[
            post.snapshot.files > 0 &&
              t('approvals.ready.media', { n: formatNumber(post.snapshot.files) }),
            post.snapshot.caption,
          ]
            .filter(Boolean)
            .join(' · ') || t('approvals.ready.noCaption')}
        </span>
      </span>
    </span>
  );
}

/** What a new request holds: kept while its dialog is open, whatever the lists reload to. */
export interface RequestDraft {
  client: ReadyClient;
  tasks: ReadyTask[];
  posts: ReadyPost[];
}

type FinalFocus = ComponentProps<typeof DialogContent>['finalFocus'];

/**
 * The new-request dialog of a screen: the draft stays while the dialog fades out, and the focus
 * goes back to the button that opened it. Sending takes the items out of what is ready, which
 * often disables that button: the focus then goes to `fallback`, else the selected tab.
 */
export function useRequestDialog(
  fallback: (draft: RequestDraft) => HTMLElement | null = () => null,
) {
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const shown = useShownWhileClosing(draft);
  const opener = useRef<HTMLElement | null>(null);
  const finalFocus: FinalFocus = () => {
    const button = opener.current;
    if (button?.isConnected && !button.matches(':disabled')) return button;
    return (
      (shown && fallback(shown)) ||
      document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ||
      true
    );
  };
  return {
    open(next: RequestDraft) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setDraft(next);
    },
    dialog: { draft: shown, open: draft !== null, onClose: () => setDraft(null), finalFocus },
  };
}

/**
 * A new approval request (spec F09, screen 2; F08 rule 21): ready tasks and posts of one client
 * for a contact with final-approval authority, with the titles the client will read. Tasks come
 * first, then the posts in publish order, as the client page lists them. On success the link is
 * shown this once (rule 9). Each opening starts afresh: the content mounts with the dialog.
 */
export function RequestDialog({
  draft,
  open,
  onClose,
  finalFocus,
}: ReturnType<typeof useRequestDialog>['dialog']) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl" finalFocus={finalFocus}>
        {draft && <RequestSteps draft={draft} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function RequestSteps({ draft, onClose }: { draft: RequestDraft; onClose: () => void }) {
  const [issued, setIssued] = useState<IssuedApprovalRequest | null>(null);
  return issued ? (
    <IssuedStep request={issued} onClose={onClose} />
  ) : (
    <RequestForm
      client={draft.client}
      tasks={draft.tasks}
      posts={draft.posts}
      onIssued={setIssued}
    />
  );
}

/** A row of the form: a task or a post, in the order of `items`. */
type Entry = { kind: 'task'; task: ReadyTask } | { kind: 'post'; post: ReadyPost };

function RequestForm({
  client,
  tasks,
  posts,
  onIssued,
}: {
  client: ReadyClient;
  tasks: ReadyTask[];
  posts: ReadyPost[];
  onIssued: (request: IssuedApprovalRequest) => void;
}) {
  const { t } = useTranslation();
  const ids = { contact: useId(), message: useId(), items: useId(), email: useId() };
  const create = useCreateApprovalRequest();
  // F14 email rule 19: the contacts' addresses, for "Also send by email".
  const details = useQuery(clientQuery(client.client.id));
  const [emailing, setEmailing] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  // The first invalid field takes the focus, the contact select included.
  const form = useForm<CreateApprovalRequestInput, unknown, CreateApprovalRequest>({
    resolver: standardSchemaResolver(createApprovalRequestSchema),
    shouldFocusError: false,
    defaultValues: {
      clientId: client.client.id,
      contactId: client.contacts.length === 1 ? client.contacts[0]?.id : '',
      message: '',
      items: [
        ...tasks.map((task) => ({ taskId: task.id, title: task.title })),
        ...posts.map((post) => ({ postId: post.id, title: post.title })),
      ],
    },
  });
  const entries: Entry[] = [
    ...tasks.map((task) => ({ kind: 'task' as const, task })),
    ...posts.map((post) => ({ kind: 'post' as const, post })),
  ];
  const fields = useRef<HTMLFormElement>(null);
  useFocusFirstError(form.formState.submitCount, fields);
  const mixed = tasks.length > 0 && posts.length > 0;
  const errors = form.formState.errors;
  const contactId = form.watch('contactId');
  const contact = client.contacts.find((candidate) => candidate.id === contactId);
  const contactEmail =
    details.data?.contacts.find((candidate) => candidate.id === contactId)?.email ?? null;
  const contactItems = client.contacts.map((candidate) => ({
    value: candidate.id,
    label: candidate.phone
      ? t('approvals.request.contactWithPhone', {
          name: candidate.name,
          phone: isolateLtr(candidate.phone),
        })
      : candidate.name,
  }));
  const titles = form.watch('items');
  const message = form.watch('message');

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      onIssued(await create.mutateAsync({ ...values, email: !!contactEmail && emailing }));
    } catch (error) {
      const field = fieldOfError(error, entries);
      if (field) {
        form.setError(
          field,
          { type: SCREEN_ERROR, message: errorMessage(t, error) },
          { shouldFocus: true },
        );
      } else {
        setFailure(errorMessage(t, error));
      }
    }
  });

  return (
    <form ref={fields} className="grid gap-5" onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>{t('approvals.request.title', { client: client.client.name })}</DialogTitle>
        <DialogDescription>
          {t('approvals.request.body', {
            count: APPROVAL_LIMITS.linkDays,
            days: formatNumber(APPROVAL_LIMITS.linkDays),
          })}
        </DialogDescription>
      </DialogHeader>
      <Field invalid={!!errors.contactId}>
        <FieldLabel id={ids.contact} render={<span />}>
          {t('approvals.request.contact')}
        </FieldLabel>
        <Controller
          control={form.control}
          name="contactId"
          render={({ field }) => (
            <Select
              items={contactItems}
              value={field.value || null}
              onValueChange={(next) => {
                field.onChange(next ?? '');
                form.clearErrors('contactId');
              }}
            >
              <SelectTrigger aria-labelledby={ids.contact} onBlur={field.onBlur} ref={field.ref}>
                <SelectValue placeholder={t('approvals.request.contactPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {contactItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    <span dir="auto">{item.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {contact && !contact.phone && (
          <FieldDescription>{t('approvals.request.noPhone')}</FieldDescription>
        )}
        <FieldError match={!!errors.contactId} role={errorRole(errors.contactId)}>
          {fieldError(errors.contactId, t('approvals.request.errors.contact'))}
        </FieldError>
      </Field>
      {contact && contactEmail && (
        <EmailOption
          id={ids.email}
          email={contactEmail}
          checked={emailing}
          onCheckedChange={setEmailing}
        />
      )}
      <Field invalid={!!errors.message}>
        <FieldLabel htmlFor={ids.message}>{t('approvals.request.message')}</FieldLabel>
        <Textarea
          id={ids.message}
          rows={2}
          placeholder={t('approvals.request.messagePlaceholder')}
          {...form.register('message')}
        />
        <FieldError match={!!errors.message}>{t('approvals.request.errors.message')}</FieldError>
      </Field>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{t('approvals.request.items')}</legend>
        <p className="text-sm text-muted-foreground">{t('approvals.request.itemsHint')}</p>
        {entries.map((entry, index) => {
          const error = errors.items?.[index]?.title;
          const item = entry.kind === 'task' ? entry.task : entry.post;
          const id = `${ids.items}-${item.id}`;
          return (
            <Field key={item.id} invalid={!!error}>
              <FieldLabel htmlFor={id} className="sr-only">
                {t('approvals.request.itemTitle', { title: item.title })}
              </FieldLabel>
              <span className="flex items-center gap-2">
                {mixed && <ItemKindBadge kind={entry.kind} />}
                <Input id={id} dir="auto" {...form.register(`items.${index}.title`)} />
              </span>
              <FieldDescription>
                {entry.kind === 'task' ? (
                  <SnapshotSummary snapshot={entry.task.snapshot} />
                ) : (
                  <PostSnapshotSummary post={entry.post} />
                )}
              </FieldDescription>
              <FieldError match={!!error} role={errorRole(error)}>
                {fieldError(error, t('approvals.request.errors.title'))}
              </FieldError>
            </Field>
          );
        })}
      </fieldset>
      <div className="flex flex-col gap-2 rounded-md bg-muted p-4 text-sm">
        <span className="text-xs text-muted-foreground">{t('approvals.request.preview')}</span>
        <p className="font-bold">
          {contact
            ? t('approvals.public.greeting', { name: contact.name })
            : t('approvals.request.previewGreeting')}
        </p>
        {message && <p className="whitespace-pre-line">{message}</p>}
        <ol className="flex list-inside list-decimal flex-col gap-1">
          {entries.map((entry, index) => {
            const item = entry.kind === 'task' ? entry.task : entry.post;
            return (
              <li key={item.id} dir="auto">
                {titles[index]?.title || item.title}
              </li>
            );
          })}
        </ol>
      </div>
      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {t('approvals.request.create')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function IssuedStep({ request, onClose }: { request: IssuedApprovalRequest; onClose: () => void }) {
  const { t } = useTranslation();
  // The form and its button left with the step: the focus goes to the link, selected to copy.
  const step = useRef<HTMLDivElement>(null);
  useEffect(() => step.current?.querySelector('input')?.focus(), []);
  return (
    <div ref={step} className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{t('approvals.request.issuedTitle')}</DialogTitle>
        <DialogDescription>
          {t('approvals.request.issuedBody', {
            contact: request.contact.name,
            date: formatDateTime(request.expiresAt),
          })}
        </DialogDescription>
      </DialogHeader>
      <EmailedNote email={request.email} />
      <IssuedLink
        link={request.link}
        contactName={request.contact.name}
        contactPhone={request.contactPhone}
      />
      <DialogFooter>
        <Button
          variant="outline"
          render={<Link to="/approvals/requests/$requestId" params={{ requestId: request.id }} />}
        >
          {t('approvals.request.open')}
        </Button>
        <Button onClick={onClose}>{t('approvals.request.done')}</Button>
      </DialogFooter>
    </div>
  );
}

/**
 * The field a refusal belongs to: the contact (rule 9, F14 email rule 19), or the row of the task
 * or post that is no longer ready (rule 8, F08 rule 20), named in the error's details.
 */
function fieldOfError(
  error: unknown,
  entries: Entry[],
): 'contactId' | `items.${number}.title` | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'CONTACT_NOT_APPROVER' || error.code === 'CONTACT_NO_EMAIL') {
    return 'contactId';
  }
  const details = (error.details ?? {}) as { taskId?: string; postId?: string };
  const index = entries.findIndex((entry) =>
    entry.kind === 'task' ? entry.task.id === details.taskId : entry.post.id === details.postId,
  );
  return index >= 0 ? `items.${index}.title` : null;
}

/** F14 email screen 4: "Also send by email to <contact>", checked by default. */
export function EmailOption({
  id,
  email,
  checked,
  onCheckedChange,
}: {
  id: string;
  email: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-3 text-sm">
      <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} />
      <span>
        {t('approvals.request.alsoEmail')} <bdi dir="ltr">{email}</bdi>
      </span>
    </label>
  );
}

/** Whether the new link was emailed (screen 4). */
export function EmailedNote({ email }: { email: EmailSummary | null }) {
  const { t } = useTranslation();
  const address = email?.to[0]?.email;
  return (
    <p className="text-sm text-muted-foreground">
      {address ? (
        <>
          {t('approvals.request.emailed')} <bdi dir="ltr">{address}</bdi>
        </>
      ) : (
        t('approvals.request.notEmailed')
      )}
    </p>
  );
}
