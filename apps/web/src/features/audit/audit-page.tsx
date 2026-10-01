import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  type AuditAction,
  type AuditEntityType,
  type AuditEntry,
  CLIENT_STATUSES,
  type FileOwnerType,
  PROJECT_STATUSES,
  RETAINER_STATUSES,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Field,
  FieldLabel,
  Input,
  PageHeader,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import { ChevronDownIcon, CpuIcon, FilterXIcon, HistoryIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { SystemStatus } from '../../components/system-status';
import { canAll, useMe } from '../../lib/auth';
import { everyPage } from '../../lib/every-page';
import {
  businessDayEnd,
  businessDayStart,
  formatDateTime,
  formatMonth,
  formatNumber,
} from '../../lib/format';
import { ALL, dayParam, idParam, oneOfParam, pageParam } from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { clientListQuery } from '../clients/clients.queries';
import { departmentListQuery } from '../departments/departments.queries';
import { projectListQuery } from '../projects/projects.queries';
import { retainerListQuery } from '../retainers/retainers.queries';
import { userListQuery } from '../users/users.queries';
import { auditListQuery } from './audit.queries';
import { AuditValue } from './audit-value';

export interface AuditSearch {
  entityType?: AuditEntityType;
  action?: AuditAction;
  actorId?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page?: number;
}

const PAGE_SIZE = 30;

export function parseAuditSearch(search: Record<string, unknown>): AuditSearch {
  return {
    entityType: oneOfParam(AUDIT_ENTITY_TYPES, search.entityType),
    action: oneOfParam(AUDIT_ACTIONS, search.action),
    actorId: idParam(search.actorId),
    entityId: idParam(search.entityId),
    from: dayParam(search.from),
    to: dayParam(search.to),
    page: pageParam(search.page),
  };
}

export function AuditPage({ search }: { search: AuditSearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/audit' });
  const page = search.page ?? 1;
  const names = useEntityNames();

  const entries = useQuery(
    auditListQuery({
      entityType: search.entityType,
      action: search.action,
      actorId: search.actorId,
      entityId: search.entityId,
      from: search.from ? businessDayStart(search.from) : undefined,
      to: search.to ? businessDayEnd(search.to) : undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  usePageInRange(
    page,
    entries.data?.total,
    PAGE_SIZE,
    useCallback(
      (next: number | undefined) =>
        navigate({ search: (previous) => ({ ...previous, page: next }), replace: true }),
      [navigate],
    ),
  );

  const setFilter = (next: Partial<AuditSearch>) =>
    navigate({ search: (previous) => ({ ...previous, ...next, page: undefined }), replace: true });
  const filtered = Object.entries(search).some(([key, value]) => key !== 'page' && value);

  return (
    <>
      <PageHeader
        title={t('audit.title')}
        description={t('audit.subtitle')}
        actions={<SystemStatus />}
      />
      <Filters search={search} actors={names.users} onChange={setFilter} filtered={filtered} />
      {entries.isPending ? (
        <div className="flex flex-col gap-2">
          {['a', 'b', 'c', 'd', 'e', 'f'].map((row) => (
            <Skeleton key={row} className="h-14" />
          ))}
        </div>
      ) : entries.isError ? (
        <LoadError message={t('audit.loadError')} onRetry={() => entries.refetch()} />
      ) : entries.data.items.length === 0 ? (
        <EmptyState
          icon={<HistoryIcon />}
          title={t('audit.emptyTitle')}
          description={t('audit.emptyHint')}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <ol className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
            {entries.data.items.map((entry) => (
              <AuditRow key={entry.id} entry={entry} names={names} />
            ))}
          </ol>
          <Pagination
            page={page}
            pageCount={Math.ceil(entries.data.total / PAGE_SIZE)}
            onPageChange={(next) =>
              navigate({ search: (previous) => ({ ...previous, page: next }) })
            }
            summary={t('common.pageSummary', {
              from: formatNumber((page - 1) * PAGE_SIZE + 1),
              to: formatNumber((page - 1) * PAGE_SIZE + entries.data.items.length),
              total: formatNumber(entries.data.total),
            })}
            previousLabel={t('common.previous')}
            nextLabel={t('common.next')}
          />
        </div>
      )}
    </>
  );
}

interface EntityNames {
  users: { id: string; name: string }[];
  user: (id: string) => string | undefined;
  department: (id: string) => string | undefined;
  client: (id: string) => string | undefined;
  project: (id: string) => string | undefined;
  retainer: (id: string) => string | undefined;
}

/**
 * Names for the entities and actors in the log: every user (any status), department, client,
 * project and retainer, however many (archived ones only for those who may see them).
 */
function useEntityNames(): EntityNames {
  const me = useMe();
  const queryClient = useQueryClient();
  const all = <T,>(name: string, fetchPage: Parameters<typeof everyPage<T>>[0], enabled = true) =>
    ({
      queryKey: ['audit', 'names', name],
      queryFn: () => everyPage(fetchPage),
      enabled,
      staleTime: 60_000,
    }) as const;
  const users = useQuery(
    all('users', (page) =>
      Promise.all(
        (['active', 'invited', 'archived'] as const).map((status) =>
          queryClient.fetchQuery(userListQuery({ status, page, pageSize: 100 })),
        ),
      ).then((pages) => ({
        items: pages.flatMap((one) => one.items),
        total: Math.max(...pages.map((one) => one.total)),
        pageSize: 100,
      })),
    ),
  ).data;
  const departments = useQuery(departmentListQuery).data;
  const clients = useQuery(
    all('clients', (page) =>
      queryClient.fetchQuery(
        clientListQuery({ status: [...CLIENT_STATUSES], page, pageSize: 100 }),
      ),
    ),
  ).data;
  const archivedClients = useQuery(
    all(
      'archived-clients',
      (page) =>
        queryClient.fetchQuery(
          clientListQuery({ status: [...CLIENT_STATUSES], archived: 'true', page, pageSize: 100 }),
        ),
      canAll(me, 'clients.manage'),
    ),
  ).data;
  const projects = useQuery(
    all('projects', (page) =>
      queryClient.fetchQuery(
        projectListQuery({ status: [...PROJECT_STATUSES], page, pageSize: 100 }),
      ),
    ),
  ).data;
  const archivedProjects = useQuery(
    all(
      'archived-projects',
      (page) =>
        queryClient.fetchQuery(
          projectListQuery({
            status: [...PROJECT_STATUSES],
            archived: 'true',
            page,
            pageSize: 100,
          }),
        ),
      canAll(me, 'projects.manage'),
    ),
  ).data;
  const retainers = useQuery(
    all('retainers', (page) =>
      queryClient.fetchQuery(
        retainerListQuery({ status: [...RETAINER_STATUSES], page, pageSize: 100 }),
      ),
    ),
  ).data;
  const archivedRetainers = useQuery(
    all(
      'archived-retainers',
      (page) =>
        queryClient.fetchQuery(
          retainerListQuery({
            status: [...RETAINER_STATUSES],
            archived: 'true',
            page,
            pageSize: 100,
          }),
        ),
      canAll(me, 'projects.manage'),
    ),
  ).data;
  return useMemo(() => {
    const people = (users ?? [])
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    const userNames = new Map(people.map((user) => [user.id, user.name]));
    const departmentNames = new Map(
      (departments?.items ?? []).map((department) => [department.id, department.name]),
    );
    const clientNames = new Map(
      [...(clients ?? []), ...(archivedClients ?? [])].map((client) => [
        client.id,
        client.tradeName,
      ]),
    );
    const projectNames = new Map(
      [...(projects ?? []), ...(archivedProjects ?? [])].map((project) => [
        project.id,
        project.name,
      ]),
    );
    const retainerNames = new Map(
      [...(retainers ?? []), ...(archivedRetainers ?? [])].map((retainer) => [
        retainer.id,
        retainer.name,
      ]),
    );
    return {
      users: people,
      user: (id) => userNames.get(id),
      department: (id) => departmentNames.get(id),
      client: (id) => clientNames.get(id),
      project: (id) => projectNames.get(id),
      retainer: (id) => retainerNames.get(id),
    };
  }, [
    users,
    departments,
    clients,
    archivedClients,
    projects,
    archivedProjects,
    retainers,
    archivedRetainers,
  ]);
}

function Filters({
  search,
  actors,
  filtered,
  onChange,
}: {
  search: AuditSearch;
  actors: { id: string; name: string }[];
  filtered: boolean;
  onChange: (next: Partial<AuditSearch>) => void;
}) {
  const { t } = useTranslation();
  const typeItems = [
    { value: ALL, label: t('audit.allTypes') },
    ...AUDIT_ENTITY_TYPES.map((type) => ({ value: type, label: t(`audit.entityTypes.${type}`) })),
  ];
  const actionItems = [
    { value: ALL, label: t('audit.allActions') },
    ...AUDIT_ACTIONS.filter(
      (action) => !search.entityType || action.startsWith(`${search.entityType}.`),
    ).map((action) => ({ value: action, label: actionLabel(t, action) })),
  ];
  const actorItems = [
    { value: ALL, label: t('audit.allActors') },
    ...actors.map((actor) => ({ value: actor.id, label: actor.name })),
  ];

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end">
      <FilterSelect
        label={t('audit.entityType')}
        items={typeItems}
        value={search.entityType ?? ALL}
        onChange={(value) =>
          onChange({
            entityType: value === ALL ? undefined : (value as AuditEntityType),
            action: undefined,
          })
        }
      />
      <FilterSelect
        label={t('audit.action')}
        items={actionItems}
        value={search.action ?? ALL}
        onChange={(value) =>
          onChange({ action: value === ALL ? undefined : (value as AuditAction) })
        }
      />
      <FilterSelect
        label={t('audit.actor')}
        items={actorItems}
        value={search.actorId ?? ALL}
        onChange={(value) => onChange({ actorId: value === ALL ? undefined : value })}
      />
      <Field>
        <FieldLabel>{t('audit.from')}</FieldLabel>
        <Input
          type="date"
          dir="ltr"
          className="text-end"
          value={search.from ?? ''}
          max={search.to}
          onChange={(event) => onChange({ from: event.target.value || undefined })}
        />
      </Field>
      <Field>
        <FieldLabel>{t('audit.to')}</FieldLabel>
        <Input
          type="date"
          dir="ltr"
          className="text-end"
          value={search.to ?? ''}
          min={search.from}
          onChange={(event) => onChange({ to: event.target.value || undefined })}
        />
      </Field>
      <Button
        variant="ghost"
        disabled={!filtered}
        onClick={() =>
          onChange({
            entityType: undefined,
            action: undefined,
            actorId: undefined,
            entityId: undefined,
            from: undefined,
            to: undefined,
          })
        }
      >
        <FilterXIcon />
        {t('audit.clear')}
      </Button>
    </div>
  );
}

function FilterSelect({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select items={items} value={value} onValueChange={(next) => onChange(next ?? ALL)}>
        <SelectTrigger className="min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function actionLabel(t: TFunction, action: AuditAction): string {
  const [entity, verb] = action.split('.') as [AuditEntityType, string];
  return t(`audit.actions.${entity}.${verb}` as 'audit.actions.user.created');
}

const actionTone = (action: AuditAction) => {
  if (action.endsWith('archived') || action.endsWith('two_factor_reset')) return 'warning';
  if (action.endsWith('created') || action.endsWith('restored') || action.endsWith('enabled'))
    return 'success';
  if (action === 'user.link_issued' || action.startsWith('user.password')) return 'info';
  return 'neutral';
};

const LINK_FIELDS = new Set([
  'clientId',
  'projectId',
  'retainerId',
  'lineId',
  'ownerType',
  'ownerId',
  'role',
]);

function AuditRow({ entry, names }: { entry: AuditEntry; names: EntityNames }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // The parent's id on a child record's entry is where its link points, not a change.
  const fields = [
    ...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})]),
  ].filter((field) => !LINK_FIELDS.has(field));
  const detailsId = `audit-${entry.id}`;

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[11rem_minmax(0,14rem)_1fr_auto]">
        <time
          dateTime={entry.occurredAt}
          className="col-span-3 text-xs text-muted-foreground tabular-nums md:col-span-1 md:text-sm"
        >
          {formatDateTime(entry.occurredAt)}
        </time>
        <span className="flex min-w-0 items-center gap-2">
          {entry.actorName ? (
            <Avatar name={entry.actorName} size="sm" />
          ) : (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <CpuIcon className="size-4" />
            </span>
          )}
          <span className="truncate text-sm font-medium">
            {entry.actorName ?? t('audit.system')}
          </span>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <Badge tone={actionTone(entry.action)}>{actionLabel(t, entry.action)}</Badge>
          <span className="text-muted-foreground">
            {t(`audit.entityTypes.${entry.entityType}`)}
          </span>
          <EntityLink entry={entry} names={names} />
        </span>
        {fields.length > 0 ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={open}
            aria-controls={detailsId}
            aria-label={open ? t('audit.hideDetails') : t('audit.showDetails')}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronDownIcon
              className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
            />
          </Button>
        ) : (
          <span className="size-8" />
        )}
      </div>
      {open && (
        <div id={detailsId} className="border-t border-border bg-muted/40 px-4 py-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start text-xs text-muted-foreground">
                <th className="w-40 py-1 text-start font-medium">{t('audit.field')}</th>
                <th className="py-1 text-start font-medium">{t('audit.before')}</th>
                <th className="py-1 text-start font-medium">{t('audit.after')}</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field} className="align-top">
                  <td className="py-1.5 pe-4 font-medium">{fieldLabel(t, field)}</td>
                  <td className="py-1.5 pe-4 text-muted-foreground">
                    <AuditValue
                      entityType={entry.entityType}
                      field={field}
                      value={entry.before?.[field]}
                    />
                  </td>
                  <td className="py-1.5">
                    <AuditValue
                      entityType={entry.entityType}
                      field={field}
                      value={entry.after?.[field]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}

const KNOWN_FIELDS = [
  'name',
  'email',
  'title',
  'phone',
  'skills',
  'roles',
  'primaryDepartment',
  'secondaryDepartments',
  'manager',
  'status',
  'twoFactorEnabled',
  'kind',
  'tradeName',
  'sector',
  'accountManager',
  'isHealthcare',
  'archived',
  'colors',
  'fonts',
  'toneOfVoice',
  'forbiddenWords',
  'files',
  'references',
  'jobTitle',
  'hasFinalApproval',
  'notes',
  'platform',
  'label',
  'url',
  'agencyAccess',
  'adminNote',
  'occurredAt',
  'channel',
  'contactId',
  'summary',
  'description',
  'departments',
  'startDate',
  'dueDate',
  'currency',
  'projectManager',
  'client',
  'milestones',
  'reason',
  'position',
  'installmentMinor',
  'projectId',
  'openTasks',
  'renewalDate',
  'monthlyFeeMinor',
  'deliverables',
  'month',
  'periodStart',
  'periodEnd',
  'lines',
  'lineId',
  'committed',
  'delivered',
  'delta',
  'retainerId',
  'requestedOn',
  'requestedByContactId',
  'estimateMinor',
  'billingStatus',
  'billingNote',
  'brief',
  'type',
  'department',
  'assigneeId',
  'assignee',
  'priority',
  'dueTime',
  'clientId',
  'milestoneId',
  'retainerCycleId',
  'cycleLineId',
  'needsClientApproval',
  'revisionLimit',
  'requestScope',
  'extraWorkItemId',
  'dependsOn',
  'checklist',
  'links',
  'note',
  'revisionSource',
  'revisionNumber',
  'overLimit',
  'overrideReason',
  'revisionId',
  'decision',
  'taskId',
  'text',
  'done',
  'site',
  'body',
  'mentionedUserIds',
  'stages',
  'steps',
  'stagesAdded',
  'stagesChanged',
  'stagesRemoved',
  'stepsAdded',
  'stepsChanged',
  'stepsRemoved',
  'user',
  'template',
  'templateId',
  'templateRunId',
  'trigger',
  'taskCount',
  'milestonesCreated',
  'brandKind',
  'confidential',
  'number',
  'sizeBytes',
  'host',
  'source',
  'previousFinal',
  'stage',
  'reviewStage',
  'outcome',
  'versions',
  'hasText',
  'length',
  'via',
  'itemId',
  'taskIds',
  'expiresAt',
  'revoked',
  'platforms',
  'publishDate',
  'publishTime',
  'responsibleId',
  'captionLength',
  'hashtagsLength',
  'hasCaption',
  'publishedAt',
  'publishedLinks',
  'fromPostId',
] as const;

function fieldLabel(t: TFunction, field: string): string {
  const known = KNOWN_FIELDS.find((name) => name === field);
  return known ? t(`audit.fields.${known}`) : field;
}

/** The client a client, contact, platform account or note entry belongs to. */
function clientIdOf(entry: AuditEntry): string | undefined {
  if (entry.entityType === 'client') return entry.entityId;
  if (entry.entityType === 'file_item') return fileOwnerOf(entry, 'client');
  const clientId = entry.after?.clientId ?? entry.before?.clientId;
  return typeof clientId === 'string' ? clientId : undefined;
}

const CLIENT_TAB: Partial<Record<AuditEntityType, 'platforms' | 'communication'>> = {
  client_platform_account: 'platforms',
  client_note: 'communication',
};

/** The client tab an entry's change shows on: brand files and documents have their own. */
function clientTabOf(entry: AuditEntry) {
  if (entry.entityType !== 'file_item') return CLIENT_TAB[entry.entityType];
  return entry.after?.role === 'brand' ? 'brand-kit' : 'files';
}

/** The owner of a file entry when it is of `type` (F10 entries carry the owner's type and id). */
function fileOwnerOf(entry: AuditEntry, type: FileOwnerType): string | undefined {
  const ownerId = entry.after?.ownerId;
  return entry.after?.ownerType === type && typeof ownerId === 'string' ? ownerId : undefined;
}

/** The retainer a retainer, cycle or extra work entry belongs to. */
function retainerIdOf(entry: AuditEntry): string | undefined {
  if (entry.entityType === 'retainer') return entry.entityId;
  if (entry.entityType === 'file_item') return fileOwnerOf(entry, 'retainer');
  if (entry.entityType !== 'retainer_cycle' && entry.entityType !== 'extra_work') return;
  const retainerId = entry.after?.retainerId ?? entry.before?.retainerId;
  return typeof retainerId === 'string' ? retainerId : undefined;
}

/** The retainer tab an entry's change shows on. */
function retainerTabOf(entry: AuditEntry): 'history' | 'extra-work' | 'documents' | undefined {
  if (entry.entityType === 'extra_work') return 'extra-work';
  if (entry.entityType === 'file_item') return 'documents';
  if (entry.action === 'retainer_cycle.closed') return 'history';
  return undefined;
}

const TASK_PARTS: AuditEntityType[] = ['task_checklist_item', 'task_link', 'task_comment'];

/** The task a task, checklist item, link or comment entry belongs to. */
function taskIdOf(entry: AuditEntry): string | undefined {
  if (entry.entityType === 'task') return entry.entityId;
  if (entry.entityType === 'file_item') return fileOwnerOf(entry, 'task');
  if (!TASK_PARTS.includes(entry.entityType)) return;
  const taskId = entry.after?.taskId ?? entry.before?.taskId;
  return typeof taskId === 'string' ? taskId : undefined;
}

/** The post a post entry or one of its files belongs to. */
function postIdOf(entry: AuditEntry): string | undefined {
  if (entry.entityType === 'post') return entry.entityId;
  if (entry.entityType === 'file_item') return fileOwnerOf(entry, 'post');
  return undefined;
}

/** The project a project, milestone or extra work entry belongs to. */
function projectIdOf(entry: AuditEntry): string | undefined {
  if (entry.entityType === 'project') return entry.entityId;
  if (entry.entityType === 'file_item') return fileOwnerOf(entry, 'project');
  if (entry.entityType !== 'project_milestone' && entry.entityType !== 'extra_work') return;
  const projectId = entry.after?.projectId ?? entry.before?.projectId;
  return typeof projectId === 'string' ? projectId : undefined;
}

/** The project tab an entry's change shows on. */
function projectTabOf(entry: AuditEntry): 'extra-work' | 'documents' | undefined {
  if (entry.entityType === 'extra_work') return 'extra-work';
  if (entry.entityType === 'file_item') return 'documents';
  return undefined;
}

/** A file entry names its file when the entry carries the name, next to its owner. */
function withFileName(t: TFunction, entry: AuditEntry, owner: string): string {
  const name = entry.entityType === 'file_item' ? entry.after?.name : undefined;
  return typeof name === 'string' ? t('audit.fileOfOwner', { file: name, owner }) : owner;
}

const linkClass = 'font-medium hover:underline';

function EntityLink({ entry, names }: { entry: AuditEntry; names: EntityNames }) {
  const { t } = useTranslation();
  const none = t('common.none');
  if (entry.entityType === 'user') {
    return (
      <Link to="/team/$userId" params={{ userId: entry.entityId }} className={linkClass}>
        {names.user(entry.entityId) ?? none}
      </Link>
    );
  }
  if (entry.entityType === 'department') {
    return (
      <Link
        to="/departments/$departmentId"
        params={{ departmentId: entry.entityId }}
        className={linkClass}
      >
        {names.department(entry.entityId) ?? none}
      </Link>
    );
  }
  const taskId = taskIdOf(entry);
  if (taskId) {
    // Entries carry the fields that changed, so the title shows only when it is one of them.
    const title = entry.entityType === 'task' ? (entry.after?.title ?? entry.before?.title) : null;
    return (
      <Link to="/tasks/$taskId" params={{ taskId }} className={linkClass}>
        {withFileName(t, entry, typeof title === 'string' ? title : t('audit.openTask'))}
      </Link>
    );
  }
  const postId = postIdOf(entry);
  if (postId) {
    const title = entry.entityType === 'post' ? (entry.after?.title ?? entry.before?.title) : null;
    return (
      <Link to="/content/posts/$postId" params={{ postId }} className={linkClass}>
        {withFileName(t, entry, typeof title === 'string' ? title : t('audit.openPost'))}
      </Link>
    );
  }
  const projectId = projectIdOf(entry);
  if (projectId) {
    const projectName = names.project(projectId) ?? t('audit.openProject');
    const milestoneName = entry.after?.name ?? entry.before?.name;
    return (
      <Link
        to="/projects/$projectId"
        params={{ projectId }}
        search={{ tab: projectTabOf(entry) }}
        className={linkClass}
      >
        {entry.entityType === 'project_milestone' && typeof milestoneName === 'string'
          ? t('audit.milestoneOfProject', { milestone: milestoneName, project: projectName })
          : withFileName(t, entry, projectName)}
      </Link>
    );
  }
  const retainerId = retainerIdOf(entry);
  if (retainerId) {
    const retainerName = names.retainer(retainerId) ?? t('audit.openRetainer');
    const month = entry.after?.month ?? entry.before?.month;
    return (
      <Link
        to="/retainers/$retainerId"
        params={{ retainerId }}
        search={{ tab: retainerTabOf(entry) }}
        className={linkClass}
      >
        {entry.entityType === 'retainer_cycle' && typeof month === 'string'
          ? t('audit.cycleOfRetainer', { month: formatMonth(month), retainer: retainerName })
          : withFileName(t, entry, retainerName)}
      </Link>
    );
  }
  const clientId = clientIdOf(entry);
  if (!clientId) return <span className="font-medium">{none}</span>;
  // A contact is named by the entry itself; the rest by their client.
  const contactName = entry.after?.name ?? entry.before?.name;
  const clientName = names.client(clientId) ?? t('audit.openClient');
  return (
    <Link
      to="/clients/$clientId"
      params={{ clientId }}
      search={{ tab: clientTabOf(entry) }}
      className={linkClass}
    >
      {entry.entityType === 'client_contact' && typeof contactName === 'string'
        ? t('audit.contactOfClient', { contact: contactName, client: clientName })
        : withFileName(t, entry, clientName)}
    </Link>
  );
}
