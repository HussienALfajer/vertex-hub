import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type DepartmentCode,
  replaceMentions,
  TASK_LIMITS,
  type TaskBriefDoc,
  type TaskComment,
  type TaskCommentDoc,
  type TaskDetail,
  type TaskReply,
  taskBriefDocSchema,
  taskCommentDocSchema,
  taskTitleSchema,
} from '@vertex-hub/contracts';
import {
  Avatar,
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
  Field,
  FieldError,
  FieldLabel,
  IconButton,
  type RichTextDoc,
  RichTextEditor,
  type RichTextNode,
  RichTextView,
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import {
  CircleCheckIcon,
  CircleHelpIcon,
  CornerDownLeftIcon,
  ForwardIcon,
  ListPlusIcon,
  MessageSquareIcon,
  PencilIcon,
  ReplyIcon,
  RotateCcwIcon,
  SendIcon,
  Trash2Icon,
} from 'lucide-react';
import { type ReactNode, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { imageSrc } from '../../lib/images';
import { useDepartmentNames } from '../projects/project-badges';
import { AttachmentList, HeldUploadList, useHeldUploads } from './task-attachments';
import { useDepartmentMembers, useDepartments } from './task-form';
import { TaskSection } from './task-parts';
import { mentionRenderer, useActiveUsers, useMentions, useRichTextLabels } from './task-rich-text';
import { AddSubtaskDialog, type SubtaskPrefill } from './task-subtasks';
import {
  type TaskThreadFilter,
  taskCommentsQuery,
  taskQuery,
  useAddComment,
  useAskQuestion,
  useEditComment,
  useForwardQuestion,
  useRemoveComment,
  useSetQuestionState,
} from './tasks.queries';

/*
 * F06B part B: the task's questions and discussion, oldest first. Comments, questions and replies
 * are rich text with mentions and attachments; a question is addressed to one person or one
 * department and is open until marked answered. The API decides every action (`canEdit`,
 * `canRemove`, `canConvert`, and a question's `canAnswer`, `canReopen`, `canForward`).
 */

export function CommentsSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const filterId = useId();
  const [filter, setFilter] = useState<TaskThreadFilter>('all');
  const comments = useInfiniteQuery(taskCommentsQuery(task.id, filter));
  const items = comments.data?.pages.flatMap((page) => page.items) ?? [];
  const closed = task.archivedAt !== null || task.readOnly;
  const [converting, setConverting] = useState<SubtaskPrefill | null>(null);
  const prefill = usePrefill(task);
  return (
    <TaskSection
      title={t('tasks.thread.title')}
      action={
        <ToggleGroup
          aria-labelledby={filterId}
          value={[filter]}
          onValueChange={(next: TaskThreadFilter[]) => next[0] && setFilter(next[0])}
        >
          <span id={filterId} className="sr-only">
            {t('tasks.thread.filter')}
          </span>
          <ToggleGroupItem value="all">{t('tasks.thread.all')}</ToggleGroupItem>
          <ToggleGroupItem value="open_questions">
            {t('tasks.thread.openQuestions')}
          </ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {comments.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : comments.isError ? (
        <LoadErrorRow onRetry={() => comments.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {filter === 'all' ? t('tasks.comments.empty') : t('tasks.thread.noOpenQuestions')}
        </p>
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
          <ol className="flex flex-col gap-5">
            {items.map((comment) => (
              <CommentItem
                key={comment.id}
                task={task}
                comment={comment}
                closed={closed}
                onConvert={(message) => setConverting(prefill(message))}
              />
            ))}
          </ol>
        </>
      )}
      {!closed && <NewMessage task={task} />}
      {converting && (
        <ConvertDialog task={task} prefill={converting} onClose={() => setConverting(null)} />
      )}
    </TaskSection>
  );
}

function LoadErrorRow({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span role="alert">{t('tasks.comments.loadError')}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}

/** A message's text with mentions as names, for a title or a brief. */
function plainText(message: TaskReply): string {
  const names = new Map(message.mentions.map((person) => [person.id.toLowerCase(), person.name]));
  return replaceMentions(message.body ?? '', (id) => `@${names.get(id) ?? '…'}`);
}

/** A comment document as a brief: the brief has no mention nodes, so they become `@Name`. */
function asBrief(doc: TaskCommentDoc | null, nameOf: (id: string) => string): TaskBriefDoc | null {
  if (!doc) return null;
  const strip = (nodes: readonly RichTextNode[]): RichTextNode[] =>
    nodes.map((node) =>
      node.type === 'mention'
        ? { type: 'text', text: `@${nameOf(String(node.attrs?.userId ?? ''))}` }
        : node.content
          ? { ...node, content: strip(node.content) }
          : node,
    );
  const parsed = taskBriefDocSchema.safeParse({
    type: 'doc',
    content: strip(doc.content as readonly RichTextNode[]),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Rule B11: the form's prefill from a question or a comment: the first line as the title, the
 * body as the brief, and the question's department, else the addressee's primary department, else
 * the author's.
 */
function usePrefill(task: TaskDetail): (message: TaskComment | TaskReply) => SubtaskPrefill {
  const users = useActiveUsers();
  const primaryOf = (userId: string | undefined): DepartmentCode | undefined =>
    users.find((user) => user.id === userId)?.departments.find((department) => department.isPrimary)
      ?.code;
  return (message) => {
    const text = plainText(message);
    const firstLine =
      text
        .split('\n')
        .find((line) => line.trim())
        ?.trim() ?? '';
    const title = taskTitleSchema.safeParse(firstLine.slice(0, 160));
    const names = new Map(message.mentions.map((person) => [person.id.toLowerCase(), person]));
    const question = 'question' in message ? message.question : null;
    return {
      title: title.success ? title.data : '',
      briefDoc: asBrief(message.bodyDoc, (id) => names.get(id.toLowerCase())?.name ?? '…'),
      department:
        question?.department ??
        primaryOf(question?.addressee?.id) ??
        primaryOf(message.author.id) ??
        task.department,
      fromCommentId: message.id,
    };
  };
}

/** On a subtask, the new subtask is a sibling under the same parent (one level only). */
function ConvertDialog({
  task,
  prefill,
  onClose,
}: {
  task: TaskDetail;
  prefill: SubtaskPrefill;
  onClose: () => void;
}) {
  const parent = useQuery({ ...taskQuery(task.parent?.id ?? ''), enabled: task.parent !== null });
  const target = task.parent ? parent.data : task;
  if (!target) return null;
  return (
    <AddSubtaskDialog
      parent={target}
      stageId={task.parent ? (task.subtasks[0]?.stageId ?? null) : null}
      prefill={prefill}
      onClose={onClose}
    />
  );
}

type Addressee = `user:${string}` | `department:${string}`;

/** The thread's editor: a comment, or a question to a person or a department (rule B1). */
function NewMessage({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const me = useMe();
  const kindId = useId();
  const addresseeId = useId();
  const [kind, setKind] = useState<'comment' | 'question'>('comment');
  const [addressee, setAddressee] = useState<Addressee | null>(null);
  const [addresseeMissing, setAddresseeMissing] = useState(false);
  const add = useAddComment(task.id);
  const ask = useAskQuestion(task.id);
  const users = useActiveUsers().filter((user) => user.id !== me.user.id);
  const departments = useDepartments();
  const items = [
    ...users.map((user) => ({ value: `user:${user.id}`, label: user.name })),
    ...departments.map(({ code, name }) => ({ value: `department:${code}`, label: name })),
  ];
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <span id={kindId} className="sr-only">
          {t('tasks.thread.kind')}
        </span>
        <ToggleGroup
          aria-labelledby={kindId}
          value={[kind]}
          onValueChange={(next: ('comment' | 'question')[]) => next[0] && setKind(next[0])}
        >
          <ToggleGroupItem value="comment">
            <MessageSquareIcon />
            {t('tasks.thread.comment')}
          </ToggleGroupItem>
          <ToggleGroupItem value="question">
            <CircleHelpIcon />
            {t('tasks.thread.ask')}
          </ToggleGroupItem>
        </ToggleGroup>
        {kind === 'question' && (
          <Field invalid={addresseeMissing} className="min-w-56 flex-1">
            <FieldLabel htmlFor={addresseeId} className="sr-only">
              {t('tasks.questions.addressee')}
            </FieldLabel>
            <Select
              items={items}
              value={addressee}
              onValueChange={(value) => {
                setAddresseeMissing(false);
                setAddressee((value as Addressee | null) ?? null);
              }}
            >
              <SelectTrigger id={addresseeId}>
                <SelectValue placeholder={t('tasks.questions.addresseePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectGroupLabel>{t('tasks.questions.departments')}</SelectGroupLabel>
                  {departments.map(({ code, name }) => (
                    <SelectItem key={code} value={`department:${code}`}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectGroupLabel>{t('tasks.questions.people')}</SelectGroupLabel>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={`user:${user.id}`}>
                      <span className="flex items-center gap-2">
                        <Avatar name={user.name} src={imageSrc(user.imageId, 'sm')} size="sm" />
                        {user.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldError match={addresseeMissing}>
              {t('tasks.questions.errors.addressee')}
            </FieldError>
          </Field>
        )}
      </div>
      <MessageComposer
        label={kind === 'question' ? t('tasks.questions.label') : t('tasks.comments.label')}
        submitLabel={kind === 'question' ? t('tasks.thread.askAction') : t('tasks.comments.send')}
        attachments
        onSubmit={async (bodyDoc, files) => {
          if (kind === 'comment') {
            await add.mutateAsync({ bodyDoc, files });
            return true;
          }
          if (!addressee) {
            setAddresseeMissing(true);
            return false;
          }
          const [type, value] = addressee.split(':') as [string, string];
          await ask.mutateAsync({
            bodyDoc,
            files,
            ...(type === 'user'
              ? { addressedUserId: value }
              : { addressedDepartment: value as DepartmentCode }),
          });
          setAddressee(null);
          toast.add({ title: t('tasks.questions.asked'), type: 'success' });
          return true;
        }}
      />
    </div>
  );
}

/**
 * Writes or edits a message: rich text with mentions, and with `attachments`, files dropped,
 * pasted or chosen. `onSubmit` resolves false when the message was not sent (a field to fix).
 */
function MessageComposer({
  label,
  submitLabel,
  initial,
  attachments,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  initial?: TaskCommentDoc | null;
  attachments?: boolean;
  onSubmit: (doc: TaskCommentDoc, files: { uploadId: string }[]) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const labels = useRichTextLabels();
  const mentions = useMentions();
  const held = useHeldUploads(TASK_LIMITS.attachments);
  // The editor starts from its default value: a new key clears it after a send.
  const [round, setRound] = useState(0);
  const doc = useRef<RichTextDoc | null>(initial ?? null);
  const [invalid, setInvalid] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (pending) return;
    setFailure(null);
    const parsed = taskCommentDocSchema.safeParse(doc.current);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    if (!held.ready) {
      setFailure(t('tasks.attachments.notReady'));
      return;
    }
    setPending(true);
    try {
      const sent = await onSubmit(parsed.data, held.files);
      if (sent) {
        doc.current = null;
        held.clear();
        setRound((current) => current + 1);
      }
    } catch (error) {
      setFailure(errorMessage(t, error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Field invalid={invalid}>
        <FieldLabel id={labelId} render={<span />} className="sr-only">
          {label}
        </FieldLabel>
        <RichTextEditor
          key={round}
          aria-labelledby={labelId}
          defaultValue={initial}
          labels={labels}
          mentions={mentions}
          compact
          invalid={invalid}
          onChange={(next) => {
            setInvalid(false);
            doc.current = next;
          }}
          onFiles={attachments ? (files, source) => held.add(files, source === 'paste') : undefined}
        />
        <FieldError match={invalid}>{t('tasks.comments.errors.body')}</FieldError>
      </Field>
      {attachments && <HeldUploadList held={held} max={TASK_LIMITS.attachments} />}
      {failure && <FormAlert>{failure}</FormAlert>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        <Button size="sm" type="button" disabled={pending} focusableWhenDisabled onClick={submit}>
          <SendIcon className="rtl:-scale-x-100" />
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function CommentItem({
  task,
  comment,
  closed,
  onConvert,
}: {
  task: TaskDetail;
  comment: TaskComment;
  closed: boolean;
  onConvert: (message: TaskComment | TaskReply) => void;
}) {
  const { t } = useTranslation();
  const add = useAddComment(task.id);
  const setState = useSetQuestionState(task.id);
  const [replying, setReplying] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const question = comment.question;

  async function changeState(state: 'answered' | 'reopen') {
    try {
      await setState.mutateAsync({ questionId: comment.id, state });
      toast.add({
        title: t(
          state === 'answered' ? 'tasks.questions.markedAnswered' : 'tasks.questions.reopened',
        ),
        type: 'success',
      });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  return (
    <li id={question ? `question-${comment.id}` : undefined} className="flex flex-col gap-3">
      <Message
        task={task}
        message={comment}
        badge={question && <QuestionState comment={comment} />}
        actions={
          !comment.removed && (
            <>
              {question && !closed && (
                <Button variant="ghost" size="sm" onClick={() => setReplying(true)}>
                  <ReplyIcon className="rtl:-scale-x-100" />
                  {t('tasks.questions.reply')}
                </Button>
              )}
              {question?.canAnswer && question.status === 'open' && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={setState.isPending}
                  onClick={() => changeState('answered')}
                >
                  <CircleCheckIcon />
                  {t('tasks.questions.markAnswered')}
                </Button>
              )}
              {question?.canReopen && question.status === 'answered' && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={setState.isPending}
                  onClick={() => changeState('reopen')}
                >
                  <RotateCcwIcon />
                  {t('tasks.questions.reopen')}
                </Button>
              )}
              {question?.canForward && (
                <Button variant="ghost" size="sm" onClick={() => setForwarding(true)}>
                  <ForwardIcon className="rtl:-scale-x-100" />
                  {t('tasks.questions.forward')}
                </Button>
              )}
              {comment.canConvert && !comment.convertedTask && (
                <Button variant="ghost" size="sm" onClick={() => onConvert(comment)}>
                  <ListPlusIcon />
                  {t('tasks.thread.convert')}
                </Button>
              )}
            </>
          )
        }
      />
      {(comment.replies.length > 0 || replying) && (
        <div className="ms-12 flex flex-col gap-3 border-s-2 border-border ps-4">
          {comment.replies.length > 0 && (
            <ol className="flex flex-col gap-3">
              {comment.replies.map((reply) => (
                <li key={reply.id}>
                  <Message
                    task={task}
                    message={reply}
                    actions={
                      reply.canConvert &&
                      !reply.convertedTask &&
                      !reply.removed && (
                        <Button variant="ghost" size="sm" onClick={() => onConvert(reply)}>
                          <ListPlusIcon />
                          {t('tasks.thread.convert')}
                        </Button>
                      )
                    }
                  />
                </li>
              ))}
            </ol>
          )}
          {replying && (
            <MessageComposer
              label={t('tasks.questions.replyLabel')}
              submitLabel={t('tasks.questions.reply')}
              attachments
              onCancel={() => setReplying(false)}
              onSubmit={async (bodyDoc, files) => {
                await add.mutateAsync({ bodyDoc, files, questionId: comment.id });
                setReplying(false);
                return true;
              }}
            />
          )}
        </div>
      )}
      {forwarding && question?.department && (
        <ForwardDialog
          task={task}
          questionId={comment.id}
          department={question.department}
          current={question.addressee?.id ?? null}
          onClose={() => setForwarding(false)}
        />
      )}
    </li>
  );
}

/** A comment, question or reply: author, text, attachments, and its edit and remove buttons. */
function Message({
  task,
  message,
  badge,
  actions,
}: {
  task: TaskDetail;
  message: TaskReply;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const edit = useEditComment(task.id);
  const remove = useRemoveComment(task.id);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const named = { name: message.author.name, time: formatDateTime(message.createdAt) };
  return (
    <div className="flex gap-3">
      <Avatar
        name={message.author.name}
        src={imageSrc(message.author.imageId)}
        tone={message.author.archived ? 'muted' : 'brand'}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{message.author.name}</span>
          <span className="text-xs text-muted-foreground">{formatDateTime(message.createdAt)}</span>
          {message.editedAt && !message.removed && (
            <span className="text-xs text-muted-foreground">{t('tasks.comments.edited')}</span>
          )}
          {badge}
          {!editing && (message.canEdit || message.canRemove) && !message.removed && (
            <span className="ms-auto flex items-center">
              {message.canEdit && (
                <IconButton
                  label={t('tasks.comments.editOf', named)}
                  onClick={() => setEditing(true)}
                >
                  <PencilIcon />
                </IconButton>
              )}
              {message.canRemove && (
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
        {message.removed || !message.bodyDoc ? (
          <p className="text-sm text-muted-foreground">{t('tasks.comments.removed')}</p>
        ) : editing ? (
          <MessageComposer
            label={t('tasks.comments.label')}
            submitLabel={t('common.save')}
            initial={message.bodyDoc}
            onCancel={() => setEditing(false)}
            onSubmit={async (bodyDoc) => {
              await edit.mutateAsync({ commentId: message.id, bodyDoc });
              setEditing(false);
              return true;
            }}
          />
        ) : (
          <RichTextView
            doc={message.bodyDoc}
            renderMention={mentionRenderer(message.mentions)}
            className="text-sm"
          />
        )}
        <AttachmentList attachments={message.attachments} author={message.author.name} />
        {message.convertedTask && (
          <Link
            to="/tasks/$taskId"
            params={{ taskId: message.convertedTask.id }}
            className="flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <CornerDownLeftIcon aria-hidden="true" className="size-4 rtl:-scale-x-100" />
            {t('tasks.thread.converted', { title: message.convertedTask.title })}
          </Link>
        )}
        {actions && <div className="flex flex-wrap items-center gap-1">{actions}</div>}
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
          await remove.mutateAsync(message.id);
        }}
      />
    </div>
  );
}

/** Rules B1–B5 and edge cases 14–15: who a question is for and whether it is answered. */
function QuestionState({ comment }: { comment: TaskComment }) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const question = comment.question;
  if (!question) return null;
  const { addressee, department } = question;
  const to = department
    ? addressee
      ? t('tasks.questions.toForwarded', {
          department: departmentName(department),
          name: addressee.name,
        })
      : t('tasks.questions.toDepartment', { department: departmentName(department) })
    : t('tasks.questions.toPerson', { name: addressee?.name ?? '…' });
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone={question.status === 'open' ? 'gold' : 'success'}>
        {question.status === 'open' ? (
          <CircleHelpIcon aria-hidden="true" />
        ) : (
          <CircleCheckIcon aria-hidden="true" />
        )}
        {t(`tasks.questionStatuses.${question.status}`)}
      </Badge>
      <span className="text-xs text-muted-foreground">{to}</span>
      {addressee?.archived && (
        <Badge tone="outline">{t('tasks.questions.addresseeArchived')}</Badge>
      )}
      {addressee && !addressee.archived && !addressee.inDepartment && department && (
        <Badge tone="outline">{t('tasks.notInDepartment')}</Badge>
      )}
      {question.status === 'answered' && question.answeredBy && question.answeredAt && (
        <span className={cn('text-xs text-muted-foreground')}>
          {t('tasks.questions.answeredBy', {
            name: question.answeredBy.name,
            time: formatDateTime(question.answeredAt),
          })}
        </span>
      )}
    </span>
  );
}

/** Rule B5: a department question forwarded to one of its members. */
function ForwardDialog({
  task,
  questionId,
  department,
  current,
  onClose,
}: {
  task: TaskDetail;
  questionId: string;
  department: DepartmentCode;
  current: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const departmentName = useDepartmentNames();
  const members = useDepartmentMembers(department).filter((member) => member.id !== current);
  const forward = useForwardQuestion(task.id);
  const [userId, setUserId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function save() {
    if (!userId) {
      setMissing(true);
      return;
    }
    setFailure(null);
    try {
      await forward.mutateAsync({ questionId, userId });
      toast.add({ title: t('tasks.questions.forwarded'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('tasks.questions.forwardTitle')}</DialogTitle>
          <DialogDescription>
            {t('tasks.questions.forwardBody', { department: departmentName(department) })}
          </DialogDescription>
        </DialogHeader>
        <Field invalid={missing}>
          <FieldLabel htmlFor={id}>{t('tasks.questions.forwardTo')}</FieldLabel>
          <Select
            items={members.map((member) => ({ value: member.id, label: member.name }))}
            value={userId}
            onValueChange={(value) => {
              setMissing(false);
              setUserId((value as string | null) ?? null);
            }}
          >
            <SelectTrigger id={id}>
              <SelectValue placeholder={t('tasks.form.assigneePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {members.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  <span className="flex items-center gap-2">
                    <Avatar name={member.name} src={imageSrc(member.imageId, 'sm')} size="sm" />
                    {member.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError match={missing}>{t('tasks.questions.errors.forwardTo')}</FieldError>
        </Field>
        {failure && <FormAlert>{failure}</FormAlert>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>
            {t('common.cancel')}
          </DialogClose>
          <Button onClick={save} disabled={forward.isPending}>
            <ForwardIcon className="rtl:-scale-x-100" />
            {t('tasks.questions.forward')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
