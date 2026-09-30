import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  BOARD_LIMITS,
  DEPARTMENT_CODES,
  type DepartmentCode,
  type Task,
  type TaskBoard,
  type TaskDetail,
  type TaskStatus,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldLabel,
  MultiCombobox,
  PageHeader,
  Skeleton,
  toast,
} from '@vertex-hub/ui';
import { ArrowLeftIcon, BanIcon, KanbanIcon, MoveIcon, UserRoundIcon } from 'lucide-react';
import { type DragEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { idParam, listParam } from '../../lib/search-params';
import { clientListQuery } from '../clients/clients.queries';
import { departmentListQuery } from '../departments/departments.queries';
import { userListQuery } from '../users/users.queries';
import { NewTaskButtons } from './my-tasks-page';
import {
  MIRRORED_ICONS,
  MOVE_ICONS,
  MoveDialog,
  needsDialog,
  type Target,
  targetsOf,
} from './task-actions';
import {
  BlockedBadge,
  formatDue,
  OverLimitBadge,
  PriorityBadge,
  TaskOverdueBadge,
  TaskStatusBadge,
} from './task-badges';
import { ALL, FilterSelect, type TaskListSearch } from './task-list-page';
import { type TaskBoardFilters, taskBoardQuery, taskQuery, useMoveTask } from './tasks.queries';

export interface TaskBoardSearch {
  /** Unset means the API's default: the departments the user manages, else their own. */
  department?: DepartmentCode[];
  /** `me` or a user id. */
  assignee?: string;
  clientId?: string;
}

/** Reads the board filters from the URL, dropping anything malformed. */
export function parseTaskBoardSearch(search: Record<string, unknown>): TaskBoardSearch {
  return {
    department: listParam(DEPARTMENT_CODES, search.department),
    assignee: search.assignee === 'me' ? 'me' : idParam(search.assignee),
    clientId: idParam(search.clientId),
  };
}

/**
 * Tasks of the chosen departments as columns by status (spec screen 3). A card moves by dragging
 * it onto a column its task may move to, or through its "Move to…" menu; moves that need input
 * open the task page's dialogs. The API enforces every rule.
 */
export function TaskBoardPage({ search }: { search: TaskBoardSearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/tasks/board' });
  const filters: TaskBoardFilters = {
    department: search.department,
    assigneeId: search.assignee,
    clientId: search.clientId,
  };
  const board = useQuery(taskBoardQuery(filters));
  const setFilter = (next: Partial<TaskBoardSearch>) =>
    navigate({ search: (previous) => ({ ...previous, ...next }), replace: true });

  return (
    <>
      <PageHeader
        title={t('tasks.board.title')}
        description={t('tasks.board.subtitle')}
        actions={<NewTaskButtons />}
      />
      <BoardFilters search={search} shown={board.data?.departments} onChange={setFilter} />
      {board.isPending ? (
        <BoardSkeleton />
      ) : board.isError ? (
        <LoadError message={t('tasks.board.loadError')} onRetry={() => board.refetch()} />
      ) : board.data.columns.every((column) => column.total === 0) ? (
        <EmptyState
          icon={<KanbanIcon />}
          title={t('tasks.board.emptyTitle')}
          description={t('tasks.board.emptyHint')}
          action={<NewTaskButtons />}
        />
      ) : (
        <Board board={board.data} search={search} />
      )}
    </>
  );
}

function BoardFilters({
  search,
  shown,
  onChange,
}: {
  search: TaskBoardSearch;
  shown: DepartmentCode[] | undefined;
  onChange: (next: Partial<TaskBoardSearch>) => void;
}) {
  const { t } = useTranslation();
  const departmentsId = useId();
  const departments = useQuery(departmentListQuery);
  const users = useQuery(userListQuery({ pageSize: 100 }));
  const clients = useQuery(
    clientListQuery({ status: ['active', 'paused', 'ended'], pageSize: 100 }),
  );
  const departmentOptions = (departments.data?.items ?? []).map(({ code, name }) => ({
    code,
    name,
  }));
  // The API's default departments show as chosen until the user picks their own.
  const chosen = search.department ?? shown ?? [];
  const assigneeItems = [
    { value: ALL, label: t('tasks.filters.allAssignees') },
    { value: 'me', label: t('tasks.filters.me') },
    ...(users.data?.items ?? []).map((user) => ({ value: user.id, label: user.name })),
  ];
  const clientItems = [
    { value: ALL, label: t('tasks.filters.allClients') },
    ...(clients.data?.items ?? []).map((client) => ({
      value: client.id,
      label: client.tradeName,
    })),
  ];

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-surface p-3 md:grid-cols-4">
      <Field className="md:col-span-2">
        <FieldLabel htmlFor={departmentsId} className="sr-only">
          {t('tasks.filters.department')}
        </FieldLabel>
        <MultiCombobox
          id={departmentsId}
          items={departmentOptions}
          value={chosen.flatMap(
            (code) => departmentOptions.find((option) => option.code === code) ?? [],
          )}
          onValueChange={(next) =>
            onChange({ department: next.length > 0 ? next.map(({ code }) => code) : undefined })
          }
          itemToLabel={(item) => item.name}
          itemToKey={(item) => item.code}
          placeholder={t('tasks.board.defaultDepartments')}
          emptyLabel={t('common.noMatches')}
          removeLabel={(label) => t('common.remove', { label })}
        />
      </Field>
      <FilterSelect
        label={t('tasks.filters.assignee')}
        items={assigneeItems}
        value={search.assignee ?? ALL}
        onChange={(value) => onChange({ assignee: value === ALL ? undefined : value })}
      />
      <FilterSelect
        label={t('tasks.filters.client')}
        items={clientItems}
        value={search.clientId ?? ALL}
        onChange={(value) => onChange({ clientId: value === ALL ? undefined : value })}
      />
    </div>
  );
}

interface Dragged {
  task: Task;
  /** The task's detail, with the moves the user may make; null while it loads. */
  detail: TaskDetail | null;
}

function Board({ board, search }: { board: TaskBoard; search: TaskBoardSearch }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const move = useMoveTask();
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [dialog, setDialog] = useState<{ task: TaskDetail; target: Target } | null>(null);

  // Cards carry list fields only: the moves come with the task's detail, loaded on drag start.
  const detailOf = (id: string) => queryClient.fetchQuery({ ...taskQuery(id), staleTime: 10_000 });
  const targetOf = (detail: TaskDetail | null, status: TaskStatus) =>
    detail && !detail.readOnly
      ? targetsOf(detail).find((target) => target.to === status)
      : undefined;

  async function run(task: TaskDetail, target: Target) {
    if (needsDialog(task, target)) {
      setDialog({ task, target });
      return;
    }
    try {
      await move.mutateAsync({ id: task.id, status: target.to, overrideDependencies: false });
      toast.add({ title: t(`tasks.moves.done.${target.move}`), type: 'success' });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  function startDrag(event: DragEvent, task: Task) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', task.id);
    setDragged({ task, detail: null });
    detailOf(task.id)
      .then((detail) =>
        setDragged((current) => (current?.task.id === task.id ? { task, detail } : current)),
      )
      .catch((error) => {
        setDragged(null);
        toast.add({ title: errorMessage(t, error), type: 'error' });
      });
  }

  function endDrag() {
    setDragged(null);
    setOver(null);
  }

  async function drop(status: TaskStatus) {
    const current = dragged;
    endDrag();
    if (!current || current.task.status === status) return;
    try {
      // A card dropped before its moves loaded waits for them.
      const detail = current.detail ?? (await detailOf(current.task.id));
      const target = targetOf(detail, status);
      if (target) await run(detail, target);
      else toast.add({ title: t('tasks.board.notAllowed'), type: 'error' });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  return (
    <>
      <p className="sr-only">{t('tasks.board.keyboardHint')}</p>
      {/* Relative: the cards' screen-reader text stays inside the scroll area. */}
      <div className="relative -mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
        <ol aria-label={t('tasks.board.title')} className="flex min-w-max items-start gap-3">
          {board.columns.map((column) => {
            const status = column.status;
            const source = dragged?.task.status === status;
            const allowed = !!dragged && !source && !!targetOf(dragged.detail, status);
            const listSearch: TaskListSearch = {
              status: [status],
              department: board.departments,
              assignee: search.assignee,
              clientId: search.clientId,
            };
            return (
              <li
                key={status}
                aria-label={t(`tasks.statuses.${status}`)}
                data-status={status}
                data-drop={dragged && !source ? (allowed ? 'allowed' : 'refused') : undefined}
                onDragOver={(event) => {
                  // While the moves load, any other column takes the drop and checks it then.
                  const loading = !!dragged && !dragged.detail && !source;
                  if (!allowed && !loading) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setOver(status);
                }}
                onDragLeave={() => setOver((current) => (current === status ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  void drop(status);
                }}
                className={cn(
                  'flex w-72 flex-col rounded-lg border border-border bg-muted/40 transition-[opacity,border-color,background-color] duration-150 ease-out',
                  allowed && 'border-primary border-dashed',
                  over === status && allowed && 'bg-primary/5',
                  dragged && !source && !allowed && 'opacity-50',
                )}
              >
                <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                  <TaskStatusBadge status={status} />
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {formatNumber(column.total)}
                  </span>
                </div>
                {column.items.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {t('tasks.board.emptyColumn')}
                  </p>
                ) : (
                  <ul className="flex max-h-[70dvh] flex-col gap-2 overflow-y-auto p-2">
                    {column.items.map((task) => (
                      <BoardCard
                        key={task.id}
                        task={task}
                        dragging={dragged?.task.id === task.id}
                        onDragStart={(event) => startDrag(event, task)}
                        onDragEnd={endDrag}
                        onMove={run}
                      />
                    ))}
                  </ul>
                )}
                {column.total > column.items.length && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="m-2 mt-0"
                    render={<Link to="/tasks/list" search={listSearch} />}
                  >
                    {t('tasks.board.seeAll', { n: formatNumber(column.total) })}
                    <ArrowLeftIcon className="ltr:-scale-x-100" />
                  </Button>
                )}
                {status === 'delivered' && (
                  <p className="px-3 pb-3 text-xs text-muted-foreground">
                    {t('tasks.board.deliveredHint', {
                      days: formatNumber(BOARD_LIMITS.deliveredDays),
                    })}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      {dialog && (
        <MoveDialog task={dialog.task} target={dialog.target} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

function BoardCard({
  task,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  task: Task;
  dragging: boolean;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  onMove: (task: TaskDetail, target: Target) => void;
}) {
  const { t } = useTranslation();
  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-task={task.id}
      className={cn(
        'flex cursor-grab flex-col gap-2 rounded-md border border-border bg-surface p-3 active:cursor-grabbing',
        dragging && 'opacity-50',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Link
            to="/tasks/$taskId"
            params={{ taskId: task.id }}
            draggable={false}
            className="font-medium hover:underline"
          >
            {task.title}
          </Link>
          <span className="truncate text-xs text-muted-foreground">
            {task.client?.name ?? t('tasks.internal')}
          </span>
        </div>
        <MoveMenu task={task} onMove={onMove} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={task.priority} />
        {task.blocked && <BlockedBadge />}
        {task.overLimitPending && <OverLimitBadge />}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
          {formatDue(task)}
          {task.overdue && <TaskOverdueBadge />}
        </span>
        {task.assignee ? (
          <span title={task.assignee.name} className="flex">
            <Avatar
              name={task.assignee.name}
              size="sm"
              tone={task.assignee.archived ? 'muted' : 'brand'}
            />
            <span className="sr-only">{task.assignee.name}</span>
          </span>
        ) : (
          <span
            title={t('tasks.unassigned')}
            className="flex size-7 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground"
          >
            <UserRoundIcon aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{t('tasks.unassigned')}</span>
          </span>
        )}
      </div>
    </li>
  );
}

/** The keyboard way to move a card: the moves load with the task's detail when the menu opens. */
function MoveMenu({
  task,
  onMove,
}: {
  task: Task;
  onMove: (task: TaskDetail, target: Target) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const detail = useQuery({ ...taskQuery(task.id), enabled: open, staleTime: 10_000 });
  const data = detail.data;
  const targets = data && !data.readOnly ? targetsOf(data) : [];
  const moves = targets.filter((target) => target.move !== 'cancel');
  const cancel = targets.find((target) => target.move === 'cancel');

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('tasks.board.moveTo', { title: task.title })}
            title={t('tasks.board.moveTo', { title: task.title })}
          />
        }
      >
        <MoveIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {detail.isPending ? (
          <DropdownMenuItem disabled>{t('common.loading')}</DropdownMenuItem>
        ) : detail.isError ? (
          <DropdownMenuItem disabled>{t('tasks.board.movesError')}</DropdownMenuItem>
        ) : !data || targets.length === 0 ? (
          <DropdownMenuItem disabled>{t('tasks.board.noMoves')}</DropdownMenuItem>
        ) : (
          <>
            {moves.map((target) => {
              const Icon = MOVE_ICONS[target.move];
              return (
                <DropdownMenuItem key={target.to} onClick={() => onMove(data, target)}>
                  <Icon className={MIRRORED_ICONS.has(Icon) ? 'rtl:-scale-x-100' : undefined} />
                  {t(`tasks.moves.${target.move}`)}
                </DropdownMenuItem>
              );
            })}
            {cancel && (
              <>
                {moves.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onClick={() => onMove(data, cancel)}>
                  <BanIcon />
                  {t('tasks.moves.cancel')}
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {['a', 'b', 'c', 'd'].map((column) => (
        <Skeleton key={column} className="h-80 w-72 shrink-0" />
      ))}
    </div>
  );
}
