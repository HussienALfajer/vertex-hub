import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { DepartmentResponse } from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
  cn,
  DepartmentMark,
  Dialog,
  DialogContent,
  DialogTrigger,
  departmentBackground,
  EmptyState,
  IconButton,
  PageHeader,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowDownUpIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  PlusIcon,
  UsersIcon,
} from 'lucide-react';
import { type DragEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatNumber } from '../../lib/format';
import { imageSrc } from '../../lib/images';
import { flagParam } from '../../lib/search-params';
import { capabilityKey } from './capabilities';
import { DepartmentIdentityForm } from './department-identity-form';
import { departmentListQuery, useReorderDepartments } from './departments.queries';

export interface DepartmentsSearch {
  /** The archived departments instead of the active ones (`users.manage`). */
  archived?: true;
}

export function parseDepartmentsSearch(search: Record<string, unknown>): DepartmentsSearch {
  return { archived: flagParam(search.archived) };
}

export function DepartmentsPage({ search }: { search: DepartmentsSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const canManage = can(me, 'users.manage');
  const canCreate = can(me, 'departments.manage');
  const navigate = useNavigate({ from: '/departments/' });
  const departments = useQuery(departmentListQuery);
  const [reordering, setReordering] = useState(false);
  const archived = canManage && search.archived === true;
  const items = departments.data?.items ?? [];
  const shown = items.filter((department) => !!department.archivedAt === archived);

  return (
    <>
      <PageHeader
        title={t('departments.title')}
        description={t('departments.subtitle')}
        actions={
          !reordering && (
            <>
              {canManage && !archived && shown.length > 1 && (
                <Button variant="outline" onClick={() => setReordering(true)}>
                  <ArrowDownUpIcon />
                  {t('departments.reorder.start')}
                </Button>
              )}
              {canCreate && <NewDepartmentDialog />}
            </>
          )
        }
      />
      {canManage && !reordering && (
        <ToggleGroup
          aria-label={t('departments.view')}
          value={[archived ? 'archived' : 'active']}
          onValueChange={(next) => {
            if (next.length === 0) return;
            void navigate({
              search: { archived: next[0] === 'archived' ? true : undefined },
              replace: true,
            });
          }}
        >
          <ToggleGroupItem value="active">{t('departments.active')}</ToggleGroupItem>
          <ToggleGroupItem value="archived">
            <ArchiveIcon />
            {t('departments.archived')}
          </ToggleGroupItem>
        </ToggleGroup>
      )}
      {departments.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => `skeleton-${index}`).map((key) => (
            <Skeleton key={key} className="h-44" />
          ))}
        </div>
      ) : departments.isError ? (
        <LoadError message={t('departments.loadError')} onRetry={() => departments.refetch()} />
      ) : reordering ? (
        <ReorderList departments={shown} onDone={() => setReordering(false)} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={archived ? <ArchiveIcon /> : <UsersIcon />}
          title={archived ? t('departments.noArchived') : t('departments.empty')}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((department) => (
            <li key={department.id}>
              <DepartmentCard department={department} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function NewDepartmentDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <PlusIcon />
        {t('departments.create.open')}
      </DialogTrigger>
      <DialogContent closeLabel={t('common.close')} className="max-w-xl">
        <DepartmentIdentityForm onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function DepartmentCard({ department }: { department: DepartmentResponse }) {
  const { t } = useTranslation();
  const capability = capabilityKey(department.code);
  const archived = !!department.archivedAt;
  return (
    <Link
      to="/departments/$departmentId"
      params={{ departmentId: department.id }}
      className={cn(
        'group relative flex h-full flex-col gap-4 overflow-hidden rounded-lg border border-border bg-surface p-5 ps-6 transition-colors duration-150 ease-out hover:border-primary',
        archived && 'text-muted-foreground',
      )}
    >
      <DepartmentStripe department={department} />
      <div className="flex items-start gap-3">
        <DepartmentMark color={department.color} icon={department.icon} muted={archived} />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg font-bold wrap-anywhere">{department.name}</h2>
          {department.description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{department.description}</p>
          )}
          {capability && !archived && <p className="text-xs text-accent-text">{t(capability)}</p>}
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4 text-sm">
        {department.archivedAt ? (
          <Badge tone="neutral">
            <ArchiveIcon />
            {t('departments.archivedOn', { date: formatDate(department.archivedAt) })}
          </Badge>
        ) : department.manager ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar
              name={department.manager.name}
              src={imageSrc(department.manager.imageId, 'sm')}
              size="sm"
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-xs text-muted-foreground">{t('departments.manager')}</span>
              <span className="truncate font-medium">{department.manager.name}</span>
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">{t('departments.noManager')}</span>
        )}
        {!archived && (
          <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground tabular-nums">
            <UsersIcon className="size-4" />
            {t('departments.memberCount', {
              count: department.memberCount,
              n: formatNumber(department.memberCount),
            })}
          </span>
        )}
      </div>
    </Link>
  );
}

/** The department's color along the card's start edge. */
function DepartmentStripe({ department }: { department: DepartmentResponse }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute inset-y-0 start-0 w-1.5',
        departmentBackground[department.color],
        department.archivedAt && 'opacity-40',
      )}
    />
  );
}

/**
 * Rule 4: the order of active departments, by dragging a row or with its up and down buttons;
 * saved as one list. A stale list is refused (edge case 12) and the list reloads.
 */
function ReorderList({
  departments,
  onDone,
}: {
  departments: DepartmentResponse[];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const reorder = useReorderDepartments();
  const [order, setOrder] = useState(departments);
  const [dragged, setDragged] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const changed = order.some((department, index) => department.id !== departments[index]?.id);

  function moveTo(id: string, index: number) {
    setOrder((current) => {
      const from = current.findIndex((department) => department.id === id);
      const moving = current[from];
      if (from < 0 || !moving || from === index) return current;
      const next = current.filter((department) => department.id !== id);
      next.splice(index, 0, moving);
      return next;
    });
  }

  async function save() {
    setFailure(null);
    if (!changed) return onDone();
    try {
      await reorder.mutateAsync(order.map((department) => department.id));
      toast.add({ title: t('departments.reorder.saved'), type: 'success' });
      onDone();
    } catch (error) {
      // Edge case 12: someone added or archived a department meanwhile; start again from the list.
      if (error instanceof ApiError && error.code === 'DEPARTMENT_ORDER_MISMATCH') {
        toast.add({ title: errorMessage(t, error), type: 'error' });
        onDone();
      } else setFailure(errorMessage(t, error));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('departments.reorder.hint')}</p>
      <ol className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
        {order.map((department, index) => (
          <li
            key={department.id}
            draggable
            onDragStart={(event: DragEvent) => {
              event.dataTransfer.effectAllowed = 'move';
              setDragged(department.id);
            }}
            onDragOver={(event: DragEvent) => {
              if (!dragged) return;
              event.preventDefault();
              moveTo(dragged, index);
            }}
            onDrop={(event: DragEvent) => {
              event.preventDefault();
              setDragged(null);
            }}
            onDragEnd={() => setDragged(null)}
            className={cn(
              'flex cursor-grab items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 active:cursor-grabbing',
              dragged === department.id && 'bg-muted opacity-60',
            )}
          >
            <GripVerticalIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="w-6 text-sm text-muted-foreground tabular-nums">
              {formatNumber(index + 1)}
            </span>
            <DepartmentMark color={department.color} icon={department.icon} size="sm" />
            <span className="min-w-0 flex-1 truncate font-medium">{department.name}</span>
            <IconButton
              label={t('departments.reorder.up', { name: department.name })}
              disabled={index === 0}
              onClick={() => moveTo(department.id, index - 1)}
            >
              <ArrowUpIcon />
            </IconButton>
            <IconButton
              label={t('departments.reorder.down', { name: department.name })}
              disabled={index === order.length - 1}
              onClick={() => moveTo(department.id, index + 1)}
            >
              <ArrowDownIcon />
            </IconButton>
          </li>
        ))}
      </ol>
      {failure && <FormAlert>{failure}</FormAlert>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={reorder.isPending}>
          {reorder.isPending ? t('common.saving') : t('departments.reorder.save')}
        </Button>
        <Button variant="outline" onClick={onDone} disabled={reorder.isPending}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
