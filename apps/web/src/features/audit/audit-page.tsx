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
  IconButton,
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
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { SystemStatus } from '../../components/system-status';
import i18n from '../../i18n';
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
import { serviceListQuery } from '../catalog/catalog.queries';
import { clientListQuery } from '../clients/clients.queries';
import { departmentListQuery } from '../departments/departments.queries';
import { projectListQuery } from '../projects/projects.queries';
import { retainerListQuery } from '../retainers/retainers.queries';
import { userListQuery } from '../users/users.queries';
import { auditListQuery } from './audit.queries';
import { shownFields } from './audit-fields';
import { type AuditNames, AuditValue } from './audit-value';

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
  const headingRef = useRef<HTMLHeadingElement>(null);

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
        headingRef={headingRef}
        title={t('audit.title')}
        description={t('audit.subtitle')}
        actions={<SystemStatus />}
      />
      <Filters search={search} actors={names.users} onChange={setFilter} filtered={filtered} />
      {search.entityId && (
        // Opened from a record's history: the filters above do not show it.
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          {t('audit.oneRecord')}
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              setFilter({ entityId: undefined });
              headingRef.current?.focus();
            }}
          >
            {t('audit.allRecords')}
          </Button>
        </p>
      )}
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

interface EntityNames extends AuditNames {
  users: { id: string; name: string }[];
  client: (id: string) => string | undefined;
  project: (id: string) => string | undefined;
  retainer: (id: string) => string | undefined;
}

/**
 * Names for the entities and actors in the log: every user (any status), department, client,
 * project, retainer and catalog service, however many (archived ones only for those who may see
 * them).
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
  const services = useQuery(
    all('services', (page) => queryClient.fetchQuery(serviceListQuery({ page, pageSize: 100 }))),
  ).data;
  const archivedServices = useQuery(
    all(
      'archived-services',
      (page) => queryClient.fetchQuery(serviceListQuery({ archived: 'true', page, pageSize: 100 })),
      canAll(me, 'catalog.manage'),
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
    const serviceNames = new Map(
      [...(services ?? []), ...(archivedServices ?? [])].map((service) => [
        service.id,
        service.name,
      ]),
    );
    return {
      users: people,
      user: (id) => userNames.get(id),
      department: (id) => departmentNames.get(id),
      service: (id) => serviceNames.get(id),
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
    services,
    archivedServices,
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
          value={search.to ?? ''}
          min={search.from}
          onChange={(event) => onChange({ to: event.target.value || undefined })}
        />
      </Field>
      <Button
        variant="ghost"
        disabled={!filtered}
        focusableWhenDisabled
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

function AuditRow({ entry, names }: { entry: AuditEntry; names: EntityNames }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const fields = shownFields(entry);
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
              <CpuIcon className="size-4" aria-hidden="true" />
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
          <IconButton
            label={open ? t('audit.hideDetails') : t('audit.showDetails')}
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronDownIcon
              className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
            />
          </IconButton>
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
                  <td className="py-1.5 pe-4 font-medium">
                    {fieldLabel(t, entry.entityType, field)}
                  </td>
                  <td className="py-1.5 pe-4 text-muted-foreground">
                    <AuditValue
                      entityType={entry.entityType}
                      field={field}
                      value={entry.before?.[field]}
                      names={names}
                    />
                  </td>
                  <td className="py-1.5">
                    <AuditValue
                      entityType={entry.entityType}
                      field={field}
                      value={entry.after?.[field]}
                      names={names}
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

function fieldLabel(t: TFunction, entityType: AuditEntityType, field: string): string {
  // A file's source is how its final version was chosen; a lead's, where it came from.
  if (field === 'source' && entityType === 'lead') return t('audit.fields.leadSource');
  if (field === 'source' && entityType === 'post') return t('audit.fields.reviewSource');
  // A file's number is its version; elsewhere it is the record's number (invoice, amendment).
  if (field === 'number' && entityType !== 'file_item') return t('audit.fields.recordNumber');
  const key = `audit.fields.${field}`;
  return i18n.exists(key) ? t(key as 'audit.fields.name') : field;
}

/** The client a client, contact, platform account or note entry belongs to. */
function clientIdOf(entry: AuditEntry): string | undefined {
  if (entry.entityType === 'client') return entry.entityId;
  if (entry.entityType === 'file_item') return fileOwnerOf(entry, 'client');
  const clientId = entry.after?.clientId ?? entry.before?.clientId;
  return typeof clientId === 'string' ? clientId : undefined;
}

const CLIENT_TAB: Partial<
  Record<AuditEntityType, 'platforms' | 'communication' | 'invoices' | 'ads'>
> = {
  client_platform_account: 'platforms',
  client_note: 'communication',
  payment: 'invoices',
  ad_wallet: 'ads',
  ad_wallet_entry: 'ads',
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

const RETAINER_PARTS: AuditEntityType[] = [
  'retainer_cycle',
  'retainer_charge',
  'retainer_term',
  'retainer_amendment',
  'extra_work',
];

/** The retainer a retainer, cycle, charge, term, amendment or extra work entry belongs to. */
function retainerIdOf(entry: AuditEntry): string | undefined {
  if (entry.entityType === 'retainer') return entry.entityId;
  if (entry.entityType === 'file_item') return fileOwnerOf(entry, 'retainer');
  if (!RETAINER_PARTS.includes(entry.entityType)) return;
  const retainerId = entry.after?.retainerId ?? entry.before?.retainerId;
  return typeof retainerId === 'string' ? retainerId : undefined;
}

/** The retainer tab an entry's change shows on. */
function retainerTabOf(
  entry: AuditEntry,
): 'contract' | 'history' | 'extra-work' | 'billing' | 'documents' | undefined {
  if (entry.entityType === 'extra_work') return 'extra-work';
  if (entry.entityType === 'retainer_term' || entry.entityType === 'retainer_amendment') {
    return 'contract';
  }
  if (entry.entityType === 'retainer_charge') return 'billing';
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

const PROJECT_PARTS: AuditEntityType[] = ['project_milestone', 'extra_work', 'project_expense'];

/** The project a project, milestone, extra work or expense entry belongs to. */
function projectIdOf(entry: AuditEntry): string | undefined {
  if (entry.entityType === 'project') return entry.entityId;
  if (entry.entityType === 'file_item') return fileOwnerOf(entry, 'project');
  if (!PROJECT_PARTS.includes(entry.entityType)) return;
  return textOf(entry, 'projectId');
}

/** The project tab an entry's change shows on. */
function projectTabOf(entry: AuditEntry): 'extra-work' | 'billing' | 'documents' | undefined {
  if (entry.entityType === 'extra_work') return 'extra-work';
  if (entry.entityType === 'project_expense') return 'billing';
  if (entry.entityType === 'file_item') return 'documents';
  return undefined;
}

/** A text field of the entry, after the change or else before it. */
function textOf(entry: AuditEntry, field: string): string | undefined {
  const value = entry.after?.[field] ?? entry.before?.[field];
  return typeof value === 'string' ? value : undefined;
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
  if (entry.entityType === 'shoot') {
    const title = entry.after?.title ?? entry.before?.title;
    return (
      <Link to="/shoots/$shootId" params={{ shootId: entry.entityId }} className={linkClass}>
        {typeof title === 'string' ? title : t('audit.openShoot')}
      </Link>
    );
  }
  if (entry.entityType === 'meeting') {
    const title = entry.after?.title ?? entry.before?.title;
    return (
      <Link to="/meetings/$meetingId" params={{ meetingId: entry.entityId }} className={linkClass}>
        {typeof title === 'string' ? title : t('audit.openMeeting')}
      </Link>
    );
  }
  const own = ownPageLink(t, entry, names);
  if (own) return own;
  const projectId = projectIdOf(entry);
  if (projectId) {
    const projectName = names.project(projectId) ?? t('audit.openProject');
    const milestoneName = entry.after?.name ?? entry.before?.name;
    const expense = textOf(entry, 'description');
    return (
      <Link
        to="/projects/$projectId"
        params={{ projectId }}
        search={{ tab: projectTabOf(entry) }}
        className={linkClass}
      >
        {entry.entityType === 'project_milestone' && typeof milestoneName === 'string'
          ? t('audit.milestoneOfProject', { milestone: milestoneName, project: projectName })
          : entry.entityType === 'project_expense' && expense
            ? t('audit.expenseOfProject', { expense, project: projectName })
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
  // Payments and ad wallet entries show on the client's tabs, by their receipt number.
  const receipt =
    entry.entityType === 'payment' || entry.entityType === 'ad_wallet_entry'
      ? (textOf(entry, 'number') ?? textOf(entry, 'receiptNumber'))
      : undefined;
  return (
    <Link
      to="/clients/$clientId"
      params={{ clientId }}
      search={{ tab: clientTabOf(entry) }}
      className={linkClass}
    >
      {entry.entityType === 'client_contact' && typeof contactName === 'string'
        ? t('audit.contactOfClient', { contact: contactName, client: clientName })
        : receipt
          ? t('audit.receiptOfClient', { receipt, client: clientName })
          : withFileName(t, entry, clientName)}
    </Link>
  );
}

/**
 * Records with a page of their own (or their parent's, for lead notes, campaign updates and
 * template runs), named by the entry when it carries the name.
 */
function ownPageLink(t: TFunction, entry: AuditEntry, names: EntityNames) {
  switch (entry.entityType) {
    case 'invoice':
      return (
        <Link
          to="/invoices/$invoiceId"
          params={{ invoiceId: entry.entityId }}
          className={linkClass}
        >
          {textOf(entry, 'number') ?? t('audit.openInvoice')}
        </Link>
      );
    case 'quote':
      return (
        <Link to="/quotes/$quoteId" params={{ quoteId: entry.entityId }} className={linkClass}>
          {textOf(entry, 'displayNumber') ?? t('audit.openQuote')}
        </Link>
      );
    case 'lead':
    case 'lead_note': {
      const leadId = entry.entityType === 'lead' ? entry.entityId : textOf(entry, 'leadId');
      if (!leadId) return null;
      return (
        <Link to="/leads/$leadId" params={{ leadId }} className={linkClass}>
          {textOf(entry, 'name') ?? t('audit.openLead')}
        </Link>
      );
    }
    case 'ad_campaign':
    case 'ad_campaign_update': {
      const own = entry.entityType === 'ad_campaign';
      const campaignId = own ? entry.entityId : textOf(entry, 'campaignId');
      if (!campaignId) return null;
      return (
        <Link to="/campaigns/$campaignId" params={{ campaignId }} className={linkClass}>
          {(own && textOf(entry, 'name')) || t('audit.openCampaign')}
        </Link>
      );
    }
    case 'template':
    case 'template_run': {
      const own = entry.entityType === 'template';
      const templateId = own ? entry.entityId : textOf(entry, 'templateId');
      if (!templateId) return null;
      return (
        <Link to="/templates/$templateId" params={{ templateId }} className={linkClass}>
          {textOf(entry, own ? 'name' : 'template') ?? t('audit.openTemplate')}
        </Link>
      );
    }
    case 'catalog_service':
    case 'catalog_package':
      return (
        <Link to="/catalog" className={linkClass}>
          {textOf(entry, 'name') ?? t('audit.openCatalog')}
        </Link>
      );
    case 'quote_settings':
      return (
        <Link to="/catalog/settings" className={linkClass}>
          {t('audit.openSettings')}
        </Link>
      );
    case 'invoice_settings':
      return (
        <Link to="/invoices/settings" className={linkClass}>
          {t('audit.openSettings')}
        </Link>
      );
    case 'approval_request':
      return (
        <Link
          to="/approvals/requests/$requestId"
          params={{ requestId: entry.entityId }}
          className={linkClass}
        >
          {t('audit.openApprovalRequest')}
        </Link>
      );
    case 'file_item': {
      // Task, post, project, retainer and client files link through their owners below.
      const quoteId = fileOwnerOf(entry, 'quote');
      if (quoteId) {
        return (
          <Link to="/quotes/$quoteId" params={{ quoteId }} className={linkClass}>
            {textOf(entry, 'name')
              ? withFileName(t, entry, t('audit.quoteNoun'))
              : t('audit.openQuote')}
          </Link>
        );
      }
      const invoiceId = fileOwnerOf(entry, 'invoice');
      if (invoiceId) {
        return (
          <Link to="/invoices/$invoiceId" params={{ invoiceId }} className={linkClass}>
            {textOf(entry, 'name')
              ? withFileName(t, entry, t('audit.invoiceNoun'))
              : t('audit.openInvoice')}
          </Link>
        );
      }
      const clientId = fileOwnerOf(entry, 'ad_wallet_entry') && textOf(entry, 'clientId');
      if (!clientId) return null;
      return (
        <Link
          to="/clients/$clientId"
          params={{ clientId }}
          search={{ tab: 'ads' }}
          className={linkClass}
        >
          {withFileName(t, entry, names.client(clientId) ?? t('audit.openClient'))}
        </Link>
      );
    }
    case 'client_report': {
      // The entry's id is the client's; the month is on the entry.
      const month = textOf(entry, 'month');
      const client = names.client(entry.entityId) ?? t('audit.openClient');
      return (
        <Link
          to="/clients/$clientId/report"
          params={{ clientId: entry.entityId }}
          search={{ month }}
          className={linkClass}
        >
          {month ? t('audit.reportOfClient', { month: formatMonth(month), client }) : client}
        </Link>
      );
    }
    default:
      return null;
  }
}
