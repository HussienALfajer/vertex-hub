import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { DepartmentDetailResponse } from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
  DepartmentMark,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  FieldError,
  FieldLabel,
  PageHeader,
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
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightIcon,
  GaugeIcon,
  HistoryIcon,
  KeyRoundIcon,
  PencilIcon,
  UserCogIcon,
  UsersIcon,
} from 'lucide-react';
import { type FormEvent, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { isMissing, LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { can, useMe } from '../../lib/auth';
import { errorMessage, type Failure } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { oneOfParam, pageParam } from '../../lib/search-params';
import { AuditEntries } from '../audit/audit-page';
import { ArchiveWizard } from './archive-wizard';
import { capabilityKey } from './capabilities';
import { DepartmentGrants } from './department-grants';
import { DepartmentIdentityForm } from './department-identity-form';
import { DepartmentMembers } from './department-members';
import { DepartmentOverview } from './department-overview';
import { departmentQuery, useRestoreDepartment, useUpdateDepartment } from './departments.queries';

const DEPARTMENT_TABS = ['overview', 'members', 'grants', 'history'] as const;

type DepartmentTab = (typeof DEPARTMENT_TABS)[number];

export interface DepartmentPageSearch {
  /** Unset means the first tab the department shows. */
  tab?: DepartmentTab;
  /** The history tab's page. */
  page?: number;
}

export function parseDepartmentPageSearch(search: Record<string, unknown>): DepartmentPageSearch {
  return { tab: oneOfParam(DEPARTMENT_TABS, search.tab), page: pageParam(search.page) };
}

export function DepartmentPage({
  departmentId,
  search,
}: {
  departmentId: string;
  search: DepartmentPageSearch;
}) {
  const { t } = useTranslation();
  const department = useQuery(departmentQuery(departmentId));
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/departments" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('departments.detail.back')}
        </Button>
      </div>
      {department.isPending ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-10 w-96 max-w-full" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        </div>
      ) : department.isError ? (
        <LoadError
          message={
            isMissing(department.error)
              ? t('departments.detail.notFound')
              : t('departments.detail.loadError')
          }
          onRetry={() => department.refetch()}
          error={department.error}
        />
      ) : (
        <Department department={department.data} search={search} />
      )}
    </>
  );
}

function Department({
  department,
  search,
}: {
  department: DepartmentDetailResponse;
  search: DepartmentPageSearch;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate({ from: '/departments/$departmentId' });
  const canManage = can(me, 'users.manage');
  const canArchive = can(me, 'departments.manage');
  const canAudit = can(me, 'audit.read');
  const archived = !!department.archivedAt;
  const capability = capabilityKey(department.code);
  // Rule 26: an archived department shows no overview; history only with `audit.read`.
  const tabs = DEPARTMENT_TABS.filter(
    (tab) => !(tab === 'overview' && archived) && !(tab === 'history' && !canAudit),
  );
  const first = tabs[0] ?? 'members';
  const tab = search.tab && tabs.includes(search.tab) ? search.tab : first;
  const openTab = (next: DepartmentTab) =>
    navigate({ search: { tab: next === first ? undefined : next } });
  const openHistoryPage = useCallback(
    (page: number | undefined, replace: boolean) =>
      navigate({ search: (previous) => ({ ...previous, page }), replace }),
    [navigate],
  );

  return (
    <>
      <PageHeader
        title={
          <span className="flex min-w-0 items-center gap-3">
            <DepartmentMark
              color={department.color}
              icon={department.icon}
              size="lg"
              muted={archived}
            />
            <span className="min-w-0 wrap-anywhere">{department.name}</span>
            {archived && (
              <Badge tone="neutral">
                <ArchiveIcon />
                {t('departments.archivedBadge')}
              </Badge>
            )}
          </span>
        }
        description={
          department.description ?? (capability && !archived ? t(capability) : undefined)
        }
        actions={
          archived ? (
            canArchive && <RestoreButton department={department} />
          ) : (
            <>
              {canManage && <EditDialog department={department} />}
              {canManage && <ManagerDialog department={department} />}
              {canArchive && <ArchiveWizard department={department} />}
            </>
          )
        }
      />
      {archived && department.archivedAt && (
        <Callout
          icon={<ArchiveIcon />}
          title={
            department.archivedBy
              ? t('departments.detail.archivedBy', {
                  date: formatDate(department.archivedAt),
                  name: department.archivedBy.name,
                })
              : t('departments.archivedOn', { date: formatDate(department.archivedAt) })
          }
          description={t('departments.detail.archivedHint')}
        />
      )}
      <Tabs value={tab} onValueChange={(value: DepartmentTab) => openTab(value)}>
        <TabsList aria-label={department.name}>
          {tabs.includes('overview') && (
            <TabsTrigger value="overview">
              <GaugeIcon />
              {t('departments.detail.tabs.overview')}
            </TabsTrigger>
          )}
          <TabsTrigger value="members">
            <UsersIcon />
            {t('departments.detail.tabs.members')}
          </TabsTrigger>
          <TabsTrigger value="grants">
            <KeyRoundIcon />
            {t('departments.detail.tabs.grants')}
          </TabsTrigger>
          {tabs.includes('history') && (
            <TabsTrigger value="history">
              <HistoryIcon />
              {t('departments.detail.tabs.history')}
            </TabsTrigger>
          )}
        </TabsList>
        {tab === 'overview' && (
          <TabsContent value="overview">
            <DepartmentOverview department={department} onAddMembers={() => openTab('members')} />
          </TabsContent>
        )}
        {tab === 'members' && (
          <TabsContent value="members">
            <DepartmentMembers department={department} />
          </TabsContent>
        )}
        {tab === 'grants' && (
          <TabsContent value="grants">
            <DepartmentGrants department={department} />
          </TabsContent>
        )}
        {tab === 'history' && (
          <TabsContent value="history">
            <AuditEntries
              filters={{ entityType: 'department', entityId: department.id }}
              page={search.page ?? 1}
              onPageChange={openHistoryPage}
            />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}

// Each dialog owns its trigger, so closing it puts the focus back on the button that opened it,
// and its form mounts on every opening, so it starts from the saved department.

function EditDialog({ department }: { department: DepartmentDetailResponse }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <PencilIcon />
        {t('common.edit')}
      </DialogTrigger>
      <DialogContent closeLabel={t('common.close')} className="max-w-xl">
        <DepartmentIdentityForm department={department} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Rule 16: the department comes back empty, last in the order. */
function RestoreButton({ department }: { department: DepartmentDetailResponse }) {
  const { t } = useTranslation();
  const restore = useRestoreDepartment(department.id);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <ArchiveRestoreIcon />
        {t('departments.restore.open')}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('departments.restore.title', { name: department.name })}
        body={t('departments.restore.body')}
        action={t('departments.restore.confirm')}
        pending={restore.isPending}
        onConfirm={async () => {
          await restore.mutateAsync();
          toast.add({ title: t('departments.restore.done'), type: 'success' });
        }}
      />
    </>
  );
}

function ManagerDialog({ department }: { department: DepartmentDetailResponse }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <UserCogIcon />
        {t('departments.detail.changeManager')}
      </DialogTrigger>
      <DialogContent closeLabel={t('common.close')}>
        <ManagerForm department={department} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

const NO_MANAGER = 'none';

function ManagerForm({
  department,
  onDone,
}: {
  department: DepartmentDetailResponse;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateDepartment(department.id);
  const current = department.manager?.id ?? NO_MANAGER;
  const [choice, setChoice] = useState(current);
  const [failure, setFailure] = useState<Failure | null>(null);
  const picker = useRef<HTMLButtonElement>(null);
  // Only active members can manage (F01 rule 8).
  const items = [
    { value: NO_MANAGER, label: t('departments.detail.noManagerOption') },
    ...department.members
      .filter((member) => member.status === 'active')
      .map((member) => ({ value: member.id, label: member.name })),
  ];

  async function save(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (choice === current) return onDone();
    try {
      await update.mutateAsync({ managerId: choice === NO_MANAGER ? null : choice });
      toast.add({ title: t('departments.detail.saved'), type: 'success' });
      onDone();
    } catch (error) {
      // The chosen member left or was archived meanwhile: that is the picker's error.
      const field = error instanceof ApiError && error.code === 'MANAGER_NOT_MEMBER';
      setFailure({ message: errorMessage(t, error), field });
      if (field) picker.current?.focus();
    }
  }

  return (
    <form className="grid gap-4" onSubmit={save} noValidate>
      <DialogHeader>
        <DialogTitle>
          {t('departments.detail.changeManagerTitle', { name: department.name })}
        </DialogTitle>
        <DialogDescription>{t('departments.detail.managerHint')}</DialogDescription>
      </DialogHeader>
      <Field invalid={!!failure?.field}>
        <FieldLabel>{t('departments.detail.managerLabel')}</FieldLabel>
        <Select
          items={items}
          value={choice}
          onValueChange={(value) => setChoice(value ?? NO_MANAGER)}
        >
          <SelectTrigger ref={picker}>
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
        <FieldError match={!!failure?.field} role="alert">
          {failure?.message}
        </FieldError>
      </Field>
      {failure && !failure.field && <FormAlert>{failure.message}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
