import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type TaskComment,
  type TaskCommentInput,
  type TaskDetail,
  taskCommentInputSchema,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  FieldError,
  FieldLabel,
  IconButton,
  Skeleton,
  Textarea,
} from '@vertex-hub/ui';
import { AtSignIcon, PencilIcon, SendIcon, Trash2Icon } from 'lucide-react';
import { type RefObject, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { everyPage } from '../../lib/every-page';
import { formatDateTime } from '../../lib/format';
import { userListQuery } from '../users/users.queries';
import {
  EMPTY_DRAFT,
  editDraft,
  insertMention,
  type MentionDraft,
  splitMentions,
  toBody,
  toDraft,
} from './mentions';
import { TaskSection } from './task-parts';
import {
  taskCommentsQuery,
  useAddComment,
  useEditComment,
  useRemoveComment,
} from './tasks.queries';

/** The conversation on a task, oldest first, with @mentions of active users (rule 16). */
export function CommentsSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const comments = useInfiniteQuery(taskCommentsQuery(task.id));
  const items = comments.data?.pages.flatMap((page) => page.items) ?? [];
  const add = useAddComment(task.id);
  const closed = task.archivedAt !== null || task.readOnly;
  const heading = useRef<HTMLHeadingElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  return (
    <TaskSection title={t('tasks.comments.title')} headingRef={heading}>
      {comments.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : comments.isError ? (
        <LoadError message={t('tasks.comments.loadError')} onRetry={() => comments.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tasks.comments.empty')}</p>
      ) : (
        <>
          {comments.hasPreviousPage && (
            <Button
              variant="outline"
              className="self-center"
              onClick={() => comments.fetchPreviousPage()}
              disabled={comments.isFetchingPreviousPage}
            >
              {comments.isFetchingPreviousPage ? t('common.loading') : t('tasks.comments.older')}
            </Button>
          )}
          <ol className="flex flex-col gap-4">
            {items.map((comment) => (
              <CommentItem
                key={comment.id}
                task={task}
                comment={comment}
                fallback={closed ? heading : composer}
              />
            ))}
          </ol>
        </>
      )}
      {!closed && (
        <Composer
          inputRef={composer}
          submitLabel={t('tasks.comments.send')}
          onSubmit={async (input) => {
            await add.mutateAsync(input);
          }}
        />
      )}
    </TaskSection>
  );
}

function CommentItem({
  task,
  comment,
  fallback,
}: {
  task: TaskDetail;
  comment: TaskComment;
  /** Takes the focus once a removed comment's buttons leave with it. */
  fallback: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const edit = useEditComment(task.id);
  const remove = useRemoveComment(task.id);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  // Editing swaps the text for a form and back: the focus follows into it and back to "edit".
  const opened = useRef(false);
  useEffect(() => {
    if (editing) editor.current?.focus();
    else if (opened.current && document.activeElement === document.body) {
      editButton.current?.focus();
    }
    opened.current = editing;
  }, [editing]);
  // The comment is named by its author and time: a conversation repeats the same buttons.
  const named = {
    name: comment.author.name,
    time: formatDateTime(comment.createdAt),
  };
  return (
    <li className="flex gap-3">
      <Avatar name={comment.author.name} tone={comment.author.archived ? 'muted' : 'brand'} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{comment.author.name}</span>
          <span className="text-xs text-muted-foreground">{formatDateTime(comment.createdAt)}</span>
          {comment.editedAt && !comment.removed && (
            <span className="text-xs text-muted-foreground">{t('tasks.comments.edited')}</span>
          )}
          {!editing && (comment.canEdit || comment.canRemove) && !comment.removed && (
            <span className="ms-auto flex items-center">
              {comment.canEdit && (
                <IconButton
                  ref={editButton}
                  label={t('tasks.comments.editOf', named)}
                  onClick={() => setEditing(true)}
                >
                  <PencilIcon />
                </IconButton>
              )}
              {comment.canRemove && (
                <IconButton
                  label={t('tasks.comments.removeOf', named)}
                  onClick={() => setRemoving(true)}
                >
                  <Trash2Icon />
                </IconButton>
              )}
            </span>
          )}
        </div>
        {comment.removed || comment.body === null ? (
          <p className="text-sm text-muted-foreground">{t('tasks.comments.removed')}</p>
        ) : editing ? (
          <Composer
            inputRef={editor}
            initial={toDraft(comment.body, comment.mentions)}
            submitLabel={t('common.save')}
            onCancel={() => setEditing(false)}
            onSubmit={async (input) => {
              await edit.mutateAsync({ commentId: comment.id, ...input });
              setEditing(false);
            }}
          />
        ) : (
          <CommentBody body={comment.body} mentions={comment.mentions} />
        )}
      </div>
      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        title={t('tasks.comments.removeTitle')}
        body={t('tasks.comments.removeBody')}
        action={t('tasks.comments.remove')}
        destructive
        pending={remove.isPending}
        // Removed, the comment loses its buttons: the focus goes to the composer.
        finalFocus={() => fallback.current ?? true}
        onConfirm={async () => {
          await remove.mutateAsync(comment.id);
        }}
      />
    </li>
  );
}

/** Plain text with line breaks; mentions show the person's current name (edge case 14). */
function CommentBody({ body, mentions }: { body: string; mentions: TaskComment['mentions'] }) {
  const people = new Map(mentions.map((person) => [person.id.toLowerCase(), person]));
  return (
    <p className="text-sm whitespace-pre-line">
      {splitMentions(body).map((part, index) => {
        if ('text' in part) return part.text;
        const person = people.get(part.mention);
        return (
          <Badge
            // biome-ignore lint/suspicious/noArrayIndexKey: parts of one body never reorder
            key={index}
            tone={person?.archived ? 'outline' : 'info'}
            className={cn('mx-0.5 align-baseline', person?.archived && 'text-muted-foreground')}
          >
            @{person?.name ?? '…'}
          </Badge>
        );
      })}
    </p>
  );
}

/**
 * Writes or edits a comment. People picked from the list are shown as `@Name` and saved as their
 * tokens; typing a name without picking it leaves it as text.
 */
function Composer({
  inputRef,
  initial = EMPTY_DRAFT,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  initial?: MentionDraft;
  submitLabel: string;
  onSubmit: (input: TaskCommentInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // Every active user can be mentioned, however many there are.
  const users = useQuery({
    queryKey: ['users', 'mentionable'],
    queryFn: () =>
      everyPage((page) => queryClient.fetchQuery(userListQuery({ page, pageSize: 100 }))),
    staleTime: 60_000,
  });
  const id = useId();
  const input = inputRef;
  const [draft, setDraft] = useState<MentionDraft>(initial);
  const [invalid, setInvalid] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function mention(person: { id: string; name: string }) {
    const at = input.current?.selectionStart ?? draft.text.length;
    const { draft: next, caret } = insertMention(draft, at, person);
    setDraft(next);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(caret, caret);
    });
  }

  async function submit() {
    // The keyboard shortcut reaches here too: never send the same comment twice.
    if (pending) return;
    setFailure(null);
    const parsed = taskCommentInputSchema.safeParse({ body: toBody(draft) });
    if (!parsed.success) {
      setInvalid(true);
      input.current?.focus();
      return;
    }
    setPending(true);
    try {
      await onSubmit(parsed.data);
      setDraft(EMPTY_DRAFT);
    } catch (error) {
      setFailure(errorMessage(t, error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Field invalid={invalid}>
        <FieldLabel htmlFor={id} className="sr-only">
          {t('tasks.comments.label')}
        </FieldLabel>
        <Textarea
          ref={input}
          id={id}
          rows={3}
          value={draft.text}
          placeholder={t('tasks.comments.placeholder')}
          onChange={(event) => {
            setInvalid(false);
            setDraft((current) => editDraft(current, event.target.value));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <FieldError match={invalid}>{t('tasks.comments.errors.body')}</FieldError>
      </Field>
      {failure && <FormAlert>{failure}</FormAlert>}
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" type="button" />}>
            <AtSignIcon />
            {t('tasks.comments.mention')}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            {(users.data ?? []).map((user) => (
              <DropdownMenuItem
                key={user.id}
                onClick={() => mention({ id: user.id, name: user.name })}
              >
                <Avatar name={user.name} size="sm" />
                {user.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="ms-auto flex items-center gap-2">
          {onCancel && (
            <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          )}
          {/* It turns off once the comment is sent: focusable, so the focus stays here. */}
          <Button
            size="sm"
            type="button"
            disabled={pending || !draft.text.trim()}
            focusableWhenDisabled
            onClick={submit}
          >
            <SendIcon className="rtl:-scale-x-100" />
            {submitLabel}
          </Button>
        </span>
      </div>
    </div>
  );
}
