import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  type AuditAction,
  type AuditEntityType,
  type AuditEntry,
  CLIENT_STATUSES,
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
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { canAll, useMe } from '../../lib/auth';
import { businessDayEnd, businessDayStart, formatDateTime, formatNumber } from '../../lib/format';
import { clientListQuery } from '../clients/clients.queries';
import { departmentListQuery } from '../departments/departments.queries';
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
const ALL = 'all';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseAuditSearch(search: Record<string, unknown>): AuditSearch {
  const day = (value: unknown) =>
    typeof value === 'string' && DAY.test(value) ? value : undefined;
  const id = (value: unknown) =>
    typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
  const page = Number(search.page);
  return {
    entityType: AUDIT_ENTITY_TYPES.find((type) => type === search.entityType),
    action: AUDIT_ACTIONS.find((action) => action === search.action),
    actorId: id(search.actorId),
    entityId: id(search.entityId),
    from: day(search.from),
    to: day(search.to),
    page: Number.isInteger(page) && page > 1 ? page : undefined,
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

  const setFilter = (next: Partial<AuditSearch>) =>
    navigate({ search: (previous) => ({ ...previous, ...next, page: undefined }), replace: true });
  const filtered = Object.entries(search).some(([key, value]) => key !== 'page' && value);

  return (
    <>
      <PageHeader title={t('audit.title')} description={t('audit.subtitle')} />
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
}

/**
 * Names for the entities and actors in the log: every user (any status), department and client
 * (archived clients only for those who may see them).
 */
function useEntityNames(): EntityNames {
  const me = useMe();
  const active = useQuery(userListQuery({ status: 'active', pageSize: 100 })).data;
  const invited = useQuery(userListQuery({ status: 'invited', pageSize: 100 })).data;
  const archived = useQuery(userListQuery({ status: 'archived', pageSize: 100 })).data;
  const departments = useQuery(departmentListQuery).data;
  const clients = useQuery(clientListQuery({ status: [...CLIENT_STATUSES], pageSize: 100 })).data;
  const archivedClients = useQuery({
    ...clientListQuery({ status: [...CLIENT_STATUSES], archived: 'true', pageSize: 100 }),
    enabled: canAll(me, 'clients.manage'),
  }).data;
  return useMemo(() => {
    const users = [active, invited, archived]
      .flatMap((page) => page?.items ?? [])
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    const userNames = new Map(users.map((user) => [user.id, user.name]));
    const departmentNames = new Map(
      (departments?.items ?? []).map((department) => [department.id, department.name]),
    );
    const clientNames = new Map(
      [clients, archivedClients]
        .flatMap((page) => page?.items ?? [])
        .map((client) => [client.id, client.tradeName]),
    );
    return {
      users,
      user: (id) => userNames.get(id),
      department: (id) => departmentNames.get(id),
      client: (id) => clientNames.get(id),
    };
  }, [active, invited, archived, departments, clients, archivedClients]);
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

function AuditRow({ entry, names }: { entry: AuditEntry; names: EntityNames }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // `clientId` on a contact, platform account or note entry is where its link points, not a change.
  const fields = [
    ...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})]),
  ].filter((field) => field !== 'clientId');
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
] as const;

function fieldLabel(t: TFunction, field: string): string {
  const known = KNOWN_FIELDS.find((name) => name === field);
  return known ? t(`audit.fields.${known}`) : field;
}

/** The client a client, contact, platform account or note entry belongs to. */
function clientIdOf(entry: AuditEntry): string | undefined {
  if (entry.entityType === 'client') return entry.entityId;
  const clientId = entry.after?.clientId ?? entry.before?.clientId;
  return typeof clientId === 'string' ? clientId : undefined;
}

const CLIENT_TAB: Partial<Record<AuditEntityType, 'platforms' | 'communication'>> = {
  client_platform_account: 'platforms',
  client_note: 'communication',
};

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
  const clientId = clientIdOf(entry);
  if (!clientId) return <span className="font-medium">{none}</span>;
  // A contact is named by the entry itself; the rest by their client.
  const contactName = entry.after?.name ?? entry.before?.name;
  const clientName = names.client(clientId) ?? t('audit.openClient');
  return (
    <Link
      to="/clients/$clientId"
      params={{ clientId }}
      search={{ tab: CLIENT_TAB[entry.entityType] }}
      className={linkClass}
    >
      {entry.entityType === 'client_contact' && typeof contactName === 'string'
        ? t('audit.contactOfClient', { contact: contactName, client: clientName })
        : clientName}
    </Link>
  );
}
