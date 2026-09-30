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
  Skeleton,
  Textarea,
} from '@vertex-hub/ui';
import { AtSignIcon, PencilIcon, SendIcon, Trash2Icon } from 'lucide-react';
import { useRef, useState } from 'react';
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
  return (
    <TaskSection title={t('tasks.comments.title')}>
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
              <CommentItem key={comment.id} task={task} comment={comment} />
            ))}
          </ol>
        </>
      )}
      {!closed && (
        <Composer
          submitLabel={t('tasks.comments.send')}
          onSubmit={async (input) => {
            await add.mutateAsync(input);
          }}
        />
      )}
    </TaskSection>
  );
}

function CommentItem({ task, comment }: { task: TaskDetail; comment: TaskComment }) {
  const { t } = useTranslation();
  const edit = useEditComment(task.id);
  const remove = useRemoveComment(task.id);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
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
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('tasks.comments.edit')}
                  onClick={() => setEditing(true)}
                >
                  <PencilIcon />
                </Button>
              )}
              {comment.canRemove && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('tasks.comments.remove')}
                  onClick={() => setRemoving(true)}
                >
                  <Trash2Icon />
                </Button>
              )}
            </span>
          )}
        </div>
        {comment.removed || comment.body === null ? (
          <p className="text-sm text-muted-foreground">{t('tasks.comments.removed')}</p>
        ) : editing ? (
          <Composer
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
  initial = EMPTY_DRAFT,
  submitLabel,
  onSubmit,
  onCancel,
}: {
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
  const input = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<MentionDraft>(initial);
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
      setFailure(t('tasks.comments.errors.body'));
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
      <Textarea
        ref={input}
        rows={3}
        value={draft.text}
        aria-label={t('tasks.comments.label')}
        placeholder={t('tasks.comments.placeholder')}
        onChange={(event) => setDraft((current) => editDraft(current, event.target.value))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
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
          <Button size="sm" type="button" disabled={pending || !draft.text.trim()} onClick={submit}>
            <SendIcon className="rtl:-scale-x-100" />
            {submitLabel}
          </Button>
        </span>
      </div>
    </div>
  );
}
