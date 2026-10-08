import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  businessDate,
  type CreatePostTask,
  type CreatePostTaskInput,
  createPostTaskSchema,
  type DepartmentCode,
  isPostContentEditable,
  isPostOpen,
  POST_LIMITS,
  type PostDetail,
  type PostTask,
  postTaskDepartment,
  postTaskDueDate,
  postTaskTitle,
  type ReturnPostTask,
  returnPostTaskSchema,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import {
  LinkIcon,
  ListTodoIcon,
  PlusIcon,
  SearchIcon,
  TriangleAlertIcon,
  UndoIcon,
  UnlinkIcon,
} from 'lucide-react';
import { type ComponentProps, useId, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { errorMessage, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { ALL } from '../../lib/search-params';
import { useDebouncedValue } from '../../lib/use-search-text';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { PersonName, useDepartmentNames } from '../projects/project-badges';
import { lineName } from '../retainers/retainer-badges';
import { formatDue, TaskStatusBadge } from '../tasks/task-badges';
import { useDepartments } from '../tasks/task-form';
import { TaskSection } from '../tasks/task-parts';
import {
  linkableTasksQuery,
  useLinkPostTask,
  useRequestPostTask,
  useReturnPostTask,
  useUnlinkPostTask,
} from './content.queries';
import { useCycleLineOptions } from './post-form';

/*
 * The Linked tasks section of the post page (spec F08, screen 4, rules 6–9 and 12): the design
 * and video tasks that produce the post's media. The client approves the post, never the task.
 */

type FinalFocus = ComponentProps<typeof DialogContent>['finalFocus'];

export function PostTasksSection({ post }: { post: PostDetail }) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const unlink = useUnlinkPostTask(post.id);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState<PostTask | null>(null);
  const [returning, setReturning] = useState<PostTask | null>(null);
  // The dialogs keep their task while they fade out after closing.
  const shownUnlinking = useShownWhileClosing(unlinking);
  const shownReturning = useShownWhileClosing(returning);
  const heading = useRef<HTMLHeadingElement>(null);
  const linkButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // The row of the task being unlinked: its place takes the next row's button once it leaves.
  const unlinkedAt = useRef(0);
  // Rule 3: linked tasks change only in `idea` and `in_production`.
  const canChange = post.permissions.canEditContent;
  // Rule 12: a task's work goes back only while the post is in production.
  const canReturn = post.permissions.canEdit && post.status === 'in_production';
  const tasks = post.linkedTasks;
  // The button that opened a dialog, or "link a task", or the heading when the change took them
  // off the page (the fifth link hides "link a task", a sent-back task loses its button).
  const fallback = () =>
    (linkButton.current?.isConnected ? linkButton.current : heading.current) ?? true;
  const opener = useRef<HTMLElement | null>(null);
  const remember = () => {
    opener.current = document.activeElement as HTMLElement | null;
  };
  const backToOpener = () =>
    opener.current?.isConnected && opener.current !== document.body ? opener.current : fallback();

  return (
    <TaskSection
      title={t('content.tasks.title')}
      headingRef={heading}
      count={tasks.length > 0 ? formatNumber(tasks.length) : undefined}
      action={
        canChange &&
        tasks.length < POST_LIMITS.tasks && (
          <Button
            ref={linkButton}
            variant="ghost"
            size="sm"
            onClick={() => {
              remember();
              setLinking(true);
            }}
          >
            <LinkIcon />
            {t('content.tasks.link')}
          </Button>
        )
      }
    >
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {canChange ? t('content.tasks.emptyHint') : t('content.tasks.empty')}
        </p>
      ) : (
        <ul ref={list} className="flex flex-col gap-2">
          {tasks.map((task, index) => (
            <li
              key={task.id}
              className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Link
                  to="/tasks/$taskId"
                  params={{ taskId: task.id }}
                  className="w-fit max-w-full truncate font-medium hover:underline"
                >
                  {task.title}
                </Link>
                <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                  {departmentName(task.department)}
                  <span aria-hidden="true">·</span>
                  {task.assignee ? (
                    <PersonName name={task.assignee.name} archived={task.assignee.archived} />
                  ) : (
                    t('tasks.unassigned')
                  )}
                  {task.cycleLine && (
                    <>
                      <span aria-hidden="true">·</span>
                      {lineName(t, task.cycleLine)}
                    </>
                  )}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <TaskStatusBadge status={task.status} />
                {canReturn && task.status === 'approved' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      remember();
                      setReturning(task);
                    }}
                  >
                    <UndoIcon className="rtl:-scale-x-100" />
                    {t('content.tasks.return')}
                  </Button>
                )}
                {canChange && (
                  <IconButton
                    data-focus="remove"
                    label={t('content.tasks.unlinkNamed', { title: task.title })}
                    onClick={() => {
                      unlinkedAt.current = index;
                      setUnlinking(task);
                    }}
                  >
                    <UnlinkIcon />
                  </IconButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {post.permissions.canEdit &&
        isPostOpen(post.status) &&
        !isPostContentEditable(post.status) &&
        tasks.length > 0 && (
          <p className="text-xs text-muted-foreground">{t('content.tasks.lockedHint')}</p>
        )}
      <LinkTaskDialog
        post={post}
        open={linking}
        onClose={() => setLinking(false)}
        finalFocus={backToOpener}
      />
      {shownReturning && (
        <ReturnTaskDialog
          key={shownReturning.id}
          post={post}
          task={shownReturning}
          open={returning !== null}
          onClose={() => setReturning(null)}
          finalFocus={backToOpener}
        />
      )}
      <ConfirmDialog
        open={unlinking !== null}
        onClose={() => setUnlinking(null)}
        title={t('content.tasks.unlinkTitle', { title: shownUnlinking?.title ?? '' })}
        body={t('content.tasks.unlinkBody')}
        action={t('content.tasks.unlink')}
        pending={unlink.isPending}
        // The row leaves with its task: the next row's "unlink", or "link a task".
        finalFocus={() => {
          const rest = [
            ...(list.current?.querySelectorAll<HTMLElement>('[data-focus="remove"]') ?? []),
          ];
          return rest[unlinkedAt.current] ?? rest.at(-1) ?? fallback();
        }}
        onConfirm={async () => {
          if (unlinking) await unlink.mutateAsync(unlinking.id);
          toast.add({ title: t('content.tasks.unlinked'), type: 'success' });
        }}
      />
    </TaskSection>
  );
}

/**
 * Rule 12: sends an approved linked task back for changes, with what must change. After the
 * client asked for changes it counts as a client revision of the task.
 */
function ReturnTaskDialog({
  post,
  task,
  open,
  onClose,
  finalFocus,
}: {
  post: PostDetail;
  task: PostTask;
  open: boolean;
  onClose: () => void;
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const id = useId();
  const send = useReturnPostTask(post.id);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<ReturnPostTask>({
    resolver: standardSchemaResolver(returnPostTaskSchema),
    defaultValues: { note: '' },
  });
  const noteError = form.formState.errors.note;
  // The latest thing that happened to the post: the client asking for changes counts (rule 12).
  const lastResponse = post.clientResponses.at(-1);
  const lastReview = post.reviewHistory.at(-1);
  const byClient =
    lastResponse?.decision === 'changes_requested' &&
    (!lastReview || lastReview.createdAt < lastResponse.createdAt);
  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await send.mutateAsync({ taskId: task.id, note: values.note });
      toast.add({ title: t('content.tasks.returned'), type: 'success' });
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
            <DialogTitle>{t('content.tasks.returnTitle', { title: task.title })}</DialogTitle>
            <DialogDescription>
              {byClient ? t('content.tasks.returnClientBody') : t('content.tasks.returnBody')}
            </DialogDescription>
          </DialogHeader>
          <Field invalid={!!noteError}>
            <FieldLabel htmlFor={id}>{t('tasks.move.changes')}</FieldLabel>
            <Textarea
              id={id}
              rows={3}
              placeholder={t('tasks.move.changesPlaceholder')}
              {...form.register('note')}
            />
            <FieldError match={!!noteError}>{t('tasks.move.errors.changes')}</FieldError>
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('content.tasks.return')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The link-task dialog (screen 5): the client's open unlinked tasks, those of the publish month's
 * cycle first, or a new task requested from a department's queue.
 */
function LinkTaskDialog({
  post,
  open,
  onClose,
  finalFocus,
}: {
  post: PostDetail;
  open: boolean;
  onClose: () => void;
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'existing' | 'request'>('existing');
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      // The tab and both forms start again on the next opening (the content mounts anew).
      onOpenChangeComplete={(next) => !next && setTab('existing')}
    >
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{t('content.link.title')}</DialogTitle>
          <DialogDescription>{t('content.link.body')}</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(value: 'existing' | 'request') => setTab(value)}>
          <TabsList aria-label={t('content.link.title')}>
            <TabsTrigger value="existing">
              <LinkIcon />
              {t('content.link.tabs.existing')}
            </TabsTrigger>
            <TabsTrigger value="request">
              <PlusIcon />
              {t('content.link.tabs.request')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="existing">
            <ExistingTasks post={post} onDone={onClose} onRequest={() => setTab('request')} />
          </TabsContent>
          <TabsContent value="request">
            <RequestTask post={post} onDone={onClose} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function ExistingTasks({
  post,
  onDone,
  onRequest,
}: {
  post: PostDetail;
  onDone: () => void;
  onRequest: () => void;
}) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const departments = useDepartments();
  const link = useLinkPostTask(post.id);
  const [text, setText] = useState('');
  const [department, setDepartment] = useState<DepartmentCode | typeof ALL>(ALL);
  const [failure, setFailure] = useState<string | null>(null);
  const q = useDebouncedValue(text.trim());
  const tasks = useQuery(
    linkableTasksQuery(post.id, {
      q: q || undefined,
      department: department === ALL ? undefined : department,
    }),
  );
  const departmentItems = [
    { value: ALL, label: t('tasks.filters.allDepartments') },
    ...departments.map(({ code, name }) => ({ value: code, label: name })),
  ];
  const filtered = !!q || department !== ALL;

  async function choose(taskId: string) {
    setFailure(null);
    try {
      await link.mutateAsync(taskId);
      toast.add({ title: t('content.link.linked'), type: 'success' });
      onDone();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('content.link.search')}
            aria-label={t('content.link.search')}
            maxLength={100}
            className="ps-9"
          />
        </div>
        <Select
          items={departmentItems}
          value={department}
          onValueChange={(next) => setDepartment((next as DepartmentCode | null) ?? ALL)}
        >
          <SelectTrigger aria-label={t('tasks.filters.department')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {departmentItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {failure && <FormAlert>{failure}</FormAlert>}
      {tasks.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : tasks.isError ? (
        <LoadError message={t('content.link.loadError')} onRetry={() => tasks.refetch()} />
      ) : tasks.data.items.length === 0 ? (
        <EmptyState
          icon={filtered ? <SearchIcon /> : <ListTodoIcon />}
          title={filtered ? t('content.link.noMatches') : t('content.link.emptyTitle')}
          description={filtered ? undefined : t('content.link.emptyHint')}
          action={
            !filtered && (
              <Button variant="outline" onClick={onRequest}>
                <PlusIcon />
                {t('content.link.tabs.request')}
              </Button>
            )
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.data.items.map((task) => (
            <li
              key={task.id}
              className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">{task.title}</span>
                <span className="truncate text-xs text-muted-foreground tabular-nums">
                  {[
                    departmentName(task.department),
                    task.assignee?.name ?? t('tasks.unassigned'),
                    task.cycleLine ? lineName(t, task.cycleLine) : null,
                    formatDue(task),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {task.inPublishCycle && <Badge tone="gold">{t('content.link.inCycle')}</Badge>}
                <TaskStatusBadge status={task.status} />
                <Button size="sm" disabled={link.isPending} onClick={() => choose(task.id)}>
                  {t('content.link.choose')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const NO_LINE = 'none';

/**
 * Rule 9: a new task in a department's queue, linked to the post. The defaults are the API's:
 * the title from the post, the due date two work days before publishing, the brief from the
 * post's notes and caption.
 */
function RequestTask({ post, onDone }: { post: PostDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const ids = { department: useId(), line: useId() };
  const departments = useDepartments();
  const request = useRequestPostTask(post.id);
  const lines = useCycleLineOptions(post.client.id);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<CreatePostTaskInput, unknown, CreatePostTask>({
    resolver: standardSchemaResolver(createPostTaskSchema),
    defaultValues: {
      department: postTaskDepartment(post.type),
      title: postTaskTitle(post.type, post.title),
      brief: '',
      dueDate: postTaskDueDate(post.publishDate),
      cycleLineId: null,
    },
  });
  const cycleLineId = useWatch({ control: form.control, name: 'cycleLineId' });
  const chosen = lines.find((option) => option.line.id === cycleLineId)?.line;
  // Rule 9: every committed unit of the line already has a task.
  const overCommitted = !!chosen && chosen.tasks.total >= chosen.committed;
  const { errors } = form.formState;
  const departmentItems = departments.map(({ code, name }) => ({ value: code, label: name }));
  const lineItems = [
    { value: NO_LINE, label: t('content.form.noCycleLine') },
    ...lines.map((option) => ({ value: option.line.id, label: option.label })),
  ];

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await request.mutateAsync({ ...values, brief: values.brief ?? undefined });
      toast.add({ title: t('content.link.requested'), type: 'success' });
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_DATES') {
        form.setError('dueDate', {
          type: SCREEN_ERROR,
          message: t('tasks.form.errors.duePast'),
        });
        return;
      }
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel id={ids.department} render={<span />}>
            {t('tasks.form.department')}
          </FieldLabel>
          <Controller
            control={form.control}
            name="department"
            render={({ field }) => (
              <Select
                items={departmentItems}
                value={field.value}
                onValueChange={(next) => next && field.onChange(next)}
              >
                <SelectTrigger aria-labelledby={ids.department}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {departmentItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldDescription>{t('content.link.departmentHint')}</FieldDescription>
        </Field>
        <Field invalid={!!errors.dueDate}>
          <FieldLabel>{t('tasks.form.dueDate')}</FieldLabel>
          <Input type="date" dir="ltr" min={businessDate()} {...form.register('dueDate')} />
          <FieldError match={!!errors.dueDate}>
            {fieldError(errors.dueDate, t('tasks.form.errors.dueDate'))}
          </FieldError>
        </Field>
      </div>
      <Field invalid={!!errors.title}>
        <FieldLabel>{t('tasks.form.title')}</FieldLabel>
        <Input autoComplete="off" {...form.register('title')} />
        <FieldError match={!!errors.title}>{t('tasks.form.errors.title')}</FieldError>
      </Field>
      <Field invalid={!!errors.brief}>
        <FieldLabel>{t('tasks.form.brief')}</FieldLabel>
        <Textarea
          rows={3}
          placeholder={t('content.link.briefPlaceholder')}
          {...form.register('brief')}
        />
        <FieldDescription>{t('content.link.briefHint')}</FieldDescription>
        <FieldError match={!!errors.brief}>{t('tasks.form.errors.brief')}</FieldError>
      </Field>
      {lines.length > 0 && (
        <Field>
          <FieldLabel id={ids.line} render={<span />}>
            {t('content.link.cycleLine')}
          </FieldLabel>
          <Controller
            control={form.control}
            name="cycleLineId"
            render={({ field }) => (
              <Select
                items={lineItems}
                value={field.value ?? NO_LINE}
                onValueChange={(next) => field.onChange(!next || next === NO_LINE ? null : next)}
              >
                <SelectTrigger aria-labelledby={ids.line}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {lineItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldDescription>{t('content.link.cycleLineHint')}</FieldDescription>
        </Field>
      )}
      {overCommitted && chosen && (
        <Callout
          tone="warning"
          icon={<TriangleAlertIcon />}
          title={t('content.link.overCommittedTitle')}
          description={t('content.link.overCommittedBody', {
            tasks: formatNumber(chosen.tasks.total),
            committed: formatNumber(chosen.committed),
          })}
        />
      )}
      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {t('content.link.request')}
        </Button>
      </DialogFooter>
    </form>
  );
}
