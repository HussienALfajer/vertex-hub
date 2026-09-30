import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { USER_STATUSES, type UserResponse, type UserStatus } from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-hub/ui';
import { SearchIcon, UserPlusIcon, UsersIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { formatList, formatNumber } from '../../lib/format';
import { idParam, oneOfParam, pageParam, textParam } from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { useSearchText } from '../../lib/use-search-text';
import { departmentListQuery } from '../departments/departments.queries';
import { DepartmentChips, TwoFactorIndicator, UserStatusBadge } from './user-badges';
import { skillsQuery, userListQuery } from './users.queries';

export interface TeamSearch {
  search?: string;
  departmentId?: string;
  skill?: string;
  status?: UserStatus;
  page?: number;
}

const PAGE_SIZE = 25;
const ALL = 'all';

/** Reads the directory filters from the URL, dropping anything malformed. */
export function parseTeamSearch(search: Record<string, unknown>): TeamSearch {
  return {
    search: textParam(search.search, 100),
    departmentId: idParam(search.departmentId),
    skill: textParam(search.skill, 100),
    status: oneOfParam(USER_STATUSES, search.status),
    page: pageParam(search.page),
  };
}

export function TeamPage({ search }: { search: TeamSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const manager = can(me, 'users.manage');
  const navigate = useNavigate({ from: '/team/' });
  const page = search.page ?? 1;

  const users = useQuery(
    userListQuery({
      search: search.search,
      departmentId: search.departmentId,
      skill: search.skill,
      status: manager ? (search.status ?? 'active') : 'active',
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  usePageInRange(
    page,
    users.data?.total,
    PAGE_SIZE,
    useCallback(
      (next: number | undefined) =>
        navigate({ search: (previous) => ({ ...previous, page: next }), replace: true }),
      [navigate],
    ),
  );

  const setFilter = useCallback(
    (next: Partial<TeamSearch>) =>
      navigate({
        search: (previous) => ({ ...previous, ...next, page: undefined }),
        replace: true,
      }),
    [navigate],
  );

  return (
    <>
      <PageHeader
        title={t('users.title')}
        description={t('users.subtitle')}
        actions={
          manager && (
            <Button render={<Link to="/team/new" />}>
              <UserPlusIcon />
              {t('users.newUser')}
            </Button>
          )
        }
      />

      <Filters search={search} manager={manager} onChange={setFilter} />

      {users.isPending ? (
        <TableSkeleton />
      ) : users.isError ? (
        <LoadError message={t('users.loadError')} onRetry={() => users.refetch()} />
      ) : users.data.items.length === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title={t('users.emptyTitle')}
          description={t('users.emptyHint')}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <UsersTable users={users.data.items} manager={manager} />
          <Pagination
            page={page}
            pageCount={Math.ceil(users.data.total / PAGE_SIZE)}
            onPageChange={(next) =>
              navigate({ search: (previous) => ({ ...previous, page: next }) })
            }
            summary={t('common.pageSummary', {
              from: formatNumber((page - 1) * PAGE_SIZE + 1),
              to: formatNumber((page - 1) * PAGE_SIZE + users.data.items.length),
              total: formatNumber(users.data.total),
            })}
            previousLabel={t('common.previous')}
            nextLabel={t('common.next')}
          />
        </div>
      )}
    </>
  );
}

function Filters({
  search,
  manager,
  onChange,
}: {
  search: TeamSearch;
  manager: boolean;
  onChange: (next: Partial<TeamSearch>) => void;
}) {
  const { t } = useTranslation();
  const departments = useQuery(departmentListQuery);
  const skills = useQuery(skillsQuery);
  const [text, setText] = useSearchText(search.search, onChange);

  const departmentItems = [
    { value: ALL, label: t('users.allDepartments') },
    ...(departments.data?.items ?? []).map((d) => ({ value: d.id, label: d.name })),
  ];
  const skillItems = [
    { value: ALL, label: t('users.allSkills') },
    ...(skills.data?.items ?? []).map((skill) => ({ value: skill, label: skill })),
  ];
  const statusItems = USER_STATUSES.map((status) => ({
    value: status,
    label: t(`users.statuses.${status}`),
  }));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 md:flex-row md:items-center">
      <div className="relative flex-1">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('users.search')}
          aria-label={t('users.search')}
          className="ps-9"
        />
      </div>
      <FilterSelect
        label={t('users.department')}
        items={departmentItems}
        value={search.departmentId ?? ALL}
        onChange={(value) => onChange({ departmentId: value === ALL ? undefined : value })}
      />
      <FilterSelect
        label={t('users.skill')}
        items={skillItems}
        value={search.skill ?? ALL}
        onChange={(value) => onChange({ skill: value === ALL ? undefined : value })}
      />
      {manager && (
        <FilterSelect
          label={t('users.status')}
          items={statusItems}
          value={search.status ?? 'active'}
          onChange={(value) =>
            onChange({ status: value === 'active' ? undefined : (value as UserStatus) })
          }
        />
      )}
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
    <Select items={items} value={value} onValueChange={(next) => onChange(next ?? ALL)}>
      <SelectTrigger aria-label={label} className="md:w-44">
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
  );
}

function UsersTable({ users, manager }: { users: UserResponse[]; manager: boolean }) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('users.columns.name')}</TableHead>
          <TableHead>{t('users.columns.department')}</TableHead>
          <TableHead>{t('users.columns.title')}</TableHead>
          <TableHead>{t('users.columns.phone')}</TableHead>
          <TableHead>{t('users.columns.skills')}</TableHead>
          {manager && <TableHead>{t('users.status')}</TableHead>}
          {manager && <TableHead>{t('users.columns.roles')}</TableHead>}
          {manager && <TableHead className="text-center">{t('users.columns.twoFactor')}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.id}>
            <TableCell>
              <Link
                to="/team/$userId"
                params={{ userId: user.id }}
                className="group flex items-center gap-3 rounded-md outline-offset-4"
              >
                <Avatar
                  name={user.name}
                  size="sm"
                  tone={user.status === 'archived' ? 'muted' : 'brand'}
                />
                <span className="flex flex-col">
                  <span className="font-medium group-hover:underline">{user.name}</span>
                  {user.email && (
                    <span dir="ltr" className="text-end text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  )}
                </span>
              </Link>
            </TableCell>
            <TableCell className="whitespace-normal">
              <DepartmentChips departments={user.departments} />
            </TableCell>
            <TableCell>{user.title ?? t('common.none')}</TableCell>
            <TableCell>
              {user.phone ? (
                <span dir="ltr">{user.phone}</span>
              ) : (
                <span className="text-muted-foreground">{t('common.none')}</span>
              )}
            </TableCell>
            <TableCell className="whitespace-normal">
              <SkillList skills={user.skills} />
            </TableCell>
            {manager && (
              <TableCell>{user.status && <UserStatusBadge status={user.status} />}</TableCell>
            )}
            {manager && (
              <TableCell className="whitespace-normal">
                <div className="flex flex-wrap gap-1">
                  {(user.roles ?? []).map((role) => (
                    <Badge key={role} tone={role === 'general_manager' ? 'brand' : 'outline'}>
                      {t(`roles.${role}`)}
                    </Badge>
                  ))}
                </div>
              </TableCell>
            )}
            {manager && (
              <TableCell>
                <div className="flex justify-center">
                  <TwoFactorIndicator enabled={user.twoFactorEnabled ?? false} />
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SkillList({ skills }: { skills: string[] }) {
  const { t } = useTranslation();
  if (skills.length === 0) return <span className="text-muted-foreground">{t('common.none')}</span>;
  const shown = skills.slice(0, 3);
  return (
    <div className="flex max-w-64 flex-wrap gap-1">
      {shown.map((skill) => (
        <Badge key={skill} tone="neutral">
          {skill}
        </Badge>
      ))}
      {skills.length > shown.length && (
        <Badge tone="outline" dir="ltr" title={formatList(skills.slice(3))}>
          {t('users.moreSkills', { count: skills.length - shown.length })}
        </Badge>
      )}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {['a', 'b', 'c', 'd', 'e'].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="ms-auto h-4 w-32" />
        </div>
      ))}
    </div>
  );
}
