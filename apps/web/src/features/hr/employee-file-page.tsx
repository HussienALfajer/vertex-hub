import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type EmployeeFile, type SalaryChange, WEEKDAYS } from '@vertex-hub/contracts';
import {
  AscentLines,
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArrowRightIcon,
  BanknoteIcon,
  BriefcaseBusinessIcon,
  CalendarClockIcon,
  FileTextIcon,
  IdCardIcon,
  PencilIcon,
  PlusIcon,
  UserXIcon,
  WalletIcon,
} from 'lucide-react';
import { type ReactNode, type RefObject, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { isMissing, LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
import { can, useMe } from '../../lib/auth';
import { formatDate, formatList, formatNumber } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { OwnerDocumentsTab } from '../files/owner-documents-tab';
import { EmployeeStatusBadge } from './employee-badges';
import {
  ArchiveSalaryDialog,
  ContractDialog,
  EndServiceDialog,
  PayoutDialog,
  PersonalDialog,
  SalaryDialog,
} from './employee-dialogs';
import { employeeQuery, salaryChangesQuery, useClearEnd } from './hr.queries';

const FILE_TABS = ['personal', 'contract', 'pay', 'documents'] as const;

type FileTab = (typeof FILE_TABS)[number];

export interface EmployeeFileSearch {
  /** Unset means the first tab the viewer can see. */
  tab?: FileTab;
}

export function parseEmployeeFileSearch(search: Record<string, unknown>): EmployeeFileSearch {
  return { tab: FILE_TABS.find((tab) => tab === search.tab) };
}

/**
 * An employee file (spec F17, screen "Employee file"): HR at `/hr/people/:userId`, the employee
 * read-only at `/me/file` (`self`). Its sections follow rule A2.
 */
export function EmployeeFilePage({
  userId,
  search,
  self,
}: {
  userId: string;
  search: EmployeeFileSearch;
  self?: boolean;
}) {
  const { t } = useTranslation();
  const file = useQuery(employeeQuery(userId));

  return (
    <>
      {!self && (
        <div>
          <Button variant="ghost" size="sm" render={<Link to="/hr/people" />}>
            <ArrowRightIcon className="ltr:-scale-x-100" />
            {t('hr.file.back')}
          </Button>
        </div>
      )}
      {file.isPending ? (
        <FileSkeleton />
      ) : file.isError ? (
        <LoadError
          message={isMissing(file.error) ? t('hr.file.notFound') : t('hr.file.loadError')}
          onRetry={() => file.refetch()}
          error={file.error}
        />
      ) : (
        <File file={file.data} search={search} self={self ?? false} />
      )}
    </>
  );
}

function File({
  file,
  search,
  self,
}: {
  file: EmployeeFile;
  search: EmployeeFileSearch;
  self: boolean;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  // An ended file is the record of a closed account: read-only until F01 restores the account.
  const live = file.status !== 'ended';
  const manage = !self && live && can(me, 'employees.manage');
  const tabs = FILE_TABS.filter(
    (tab) =>
      (tab === 'personal' && file.personal) ||
      (tab === 'contract' && file.employment) ||
      (tab === 'pay' && file.pay) ||
      tab === 'documents',
  );
  const tab = tabs.find((shown) => shown === search.tab) ?? tabs[0] ?? 'documents';

  const openTab = (next: FileTab) =>
    navigate({
      to: '.',
      search: { tab: next === tabs[0] ? undefined : next },
      replace: true,
    });

  return (
    <>
      <FileHero file={file} self={self} actions={manage && <EndServiceActions file={file} />} />
      <Notices file={file} />

      <Tabs value={tab} onValueChange={(value: FileTab) => openTab(value)}>
        <TabsList aria-label={self ? t('hr.file.myTitle') : t('hr.file.title')}>
          {file.personal && (
            <TabsTrigger value="personal">
              <IdCardIcon />
              {t('hr.file.tabs.personal')}
            </TabsTrigger>
          )}
          {file.employment && (
            <TabsTrigger value="contract">
              <BriefcaseBusinessIcon />
              {t('hr.file.tabs.contract')}
            </TabsTrigger>
          )}
          {file.pay && (
            <TabsTrigger value="pay">
              <WalletIcon />
              {t('hr.file.tabs.pay')}
            </TabsTrigger>
          )}
          <TabsTrigger value="documents">
            <FileTextIcon />
            {t('hr.file.tabs.documents')}
          </TabsTrigger>
        </TabsList>
        {file.personal && (
          <TabsContent value="personal">
            <PersonalTab file={file} manage={manage} />
          </TabsContent>
        )}
        {file.employment && (
          <TabsContent value="contract">
            <ContractTab file={file} manage={manage} />
          </TabsContent>
        )}
        {file.pay && (
          <TabsContent value="pay">
            <PayTab file={file} self={self} live={live} />
          </TabsContent>
        )}
        <TabsContent value="documents">
          <OwnerDocumentsTab owner={{ type: 'employee', id: file.userId }} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/** The person at a glance, with the 60° hairlines at the edge of the card (§5). */
function FileHero({
  file,
  self,
  actions,
}: {
  file: EmployeeFile;
  self: boolean;
  actions: ReactNode;
}) {
  const { t } = useTranslation();
  const primary = file.departments.find((d) => d.isPrimary);
  return (
    <section className="relative flex flex-col gap-6 overflow-hidden rounded-lg border border-border bg-surface p-6 sm:flex-row sm:items-center">
      <AscentLines className="absolute inset-y-0 end-0 hidden h-full w-32 text-border md:block" />
      <Avatar
        name={file.name}
        size="xl"
        tone={file.status === 'ended' ? 'muted' : 'brand'}
        className="ring-4 ring-muted"
      />
      <div className="relative flex min-w-0 flex-1 flex-col gap-2">
        {self && <p className="text-sm text-muted-foreground">{t('hr.file.myTitle')}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{file.name}</h1>
          <EmployeeStatusBadge status={file.status} />
        </div>
        <p className="text-muted-foreground">
          {[file.title, primary?.name].filter(Boolean).join(' · ') || t('common.none')}
        </p>
      </div>
      {actions && <div className="relative flex shrink-0 items-center gap-2">{actions}</div>}
    </section>
  );
}

function Notices({ file }: { file: EmployeeFile }) {
  const { t } = useTranslation();
  const employment = file.employment;
  if (file.status === 'ended') {
    return (
      <Callout
        tone="neutral"
        icon={<ArchiveIcon />}
        title={
          employment?.endedOn
            ? t('hr.file.endedNotice', { date: formatDate(employment.endedOn) })
            : t('hr.file.archivedNotice')
        }
        description={employment && !employment.endedOn ? t('hr.file.archivedHint') : undefined}
      />
    );
  }
  if (file.status === 'leaving' && employment?.endedOn && employment.endReason) {
    return (
      <Callout
        tone="warning"
        icon={<UserXIcon />}
        title={t('hr.file.leavingNotice', { date: formatDate(employment.endedOn) })}
        description={[t(`hr.endReasons.${employment.endReason}`), employment.endNote]
          .filter(Boolean)
          .join(' · ')}
      />
    );
  }
  return null;
}

/** Rule A8: end the service, or undo it before the account is archived. */
function EndServiceActions({ file }: { file: EmployeeFile }) {
  const { t } = useTranslation();
  const [ending, setEnding] = useState(false);
  const [clearing, setClearing] = useState(false);
  const clear = useClearEnd(file.userId);
  const button = useRef<HTMLButtonElement>(null);

  if (file.status === 'leaving') {
    return (
      <>
        <Button ref={button} variant="outline" onClick={() => setClearing(true)}>
          {t('hr.end.clear')}
        </Button>
        <ConfirmDialog
          open={clearing}
          onClose={() => setClearing(false)}
          title={t('hr.end.clearTitle', { name: file.name })}
          body={t('hr.end.clearBody')}
          action={t('hr.end.clear')}
          pending={clear.isPending}
          onConfirm={async () => {
            await clear.mutateAsync();
            toast.add({ title: t('hr.end.cleared'), type: 'success' });
          }}
          finalFocus={() => button.current ?? true}
        />
      </>
    );
  }
  return (
    <>
      <Button ref={button} variant="outline" onClick={() => setEnding(true)}>
        <UserXIcon />
        {t('hr.end.action')}
      </Button>
      <EndServiceDialog
        file={file}
        open={ending}
        onClose={() => setEnding(false)}
        finalFocus={() => button.current ?? true}
      />
    </>
  );
}

function EditButton({
  label,
  onClick,
  buttonRef,
}: {
  label: string;
  onClick: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Button ref={buttonRef} variant="outline" size="sm" onClick={onClick}>
      <PencilIcon />
      {label}
    </Button>
  );
}

function PersonalTab({ file, manage }: { file: EmployeeFile; manage: boolean }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const personal = file.personal;
  if (!personal) return null;
  return (
    <div className="flex flex-col gap-4">
      <TabHeader
        title={t('hr.file.tabs.personal')}
        description={t('hr.file.personalHint')}
        action={
          manage && (
            <EditButton
              label={t('hr.file.edit')}
              onClick={() => setEditing(true)}
              buttonRef={button}
            />
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('hr.file.identity')}</CardTitle>
          </CardHeader>
          <Details>
            <Detail label={t('hr.fields.nationalId')} value={personal.nationalId} ltr />
            <Detail
              label={t('hr.fields.birthDate')}
              value={personal.birthDate && formatDate(personal.birthDate)}
            />
            <Detail label={t('hr.fields.address')} value={personal.address} />
          </Details>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('hr.file.emergency')}</CardTitle>
          </CardHeader>
          <Details>
            <Detail label={t('hr.fields.emergencyName')} value={personal.emergencyName} />
            <Detail label={t('hr.fields.emergencyRelation')} value={personal.emergencyRelation} />
            <Detail label={t('hr.fields.emergencyPhone')} value={personal.emergencyPhone} ltr />
          </Details>
        </Card>
      </div>
      <PersonalDialog
        file={file}
        open={editing}
        onClose={() => setEditing(false)}
        finalFocus={() => button.current ?? true}
      />
    </div>
  );
}

function ContractTab({ file, manage }: { file: EmployeeFile; manage: boolean }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const employment = file.employment;
  if (!employment) return null;
  const remote = WEEKDAYS.filter((day) => employment.remoteWeekdays.includes(day));
  return (
    <div className="flex flex-col gap-4">
      <TabHeader
        title={t('hr.file.tabs.contract')}
        description={t('hr.file.contractHint')}
        action={
          manage && (
            <EditButton
              label={t('hr.file.edit')}
              onClick={() => setEditing(true)}
              buttonRef={button}
            />
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('hr.file.contract')}</CardTitle>
          </CardHeader>
          <Details>
            <Detail
              label={t('hr.fields.employmentType')}
              value={t(`hr.employmentTypes.${employment.employmentType}`)}
            />
            <Detail
              label={t('hr.fields.startDate')}
              value={employment.startDate && formatDate(employment.startDate)}
            />
            <Detail
              label={t('hr.fields.probationEndDate')}
              value={employment.probationEndDate && formatDate(employment.probationEndDate)}
            />
            <Detail
              label={t('hr.fields.contractEndDate')}
              value={
                employment.contractEndDate
                  ? formatDate(employment.contractEndDate)
                  : t('hr.file.openEnded')
              }
            />
            <Detail
              label={t('hr.fields.annualLeaveDays')}
              value={t('hr.file.days', {
                count: employment.annualLeaveDays,
                days: formatNumber(employment.annualLeaveDays),
              })}
            />
          </Details>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CalendarClockIcon className="size-5 text-muted-foreground" />
              {t('hr.file.schedule')}
            </CardTitle>
          </CardHeader>
          <Details>
            <Detail label={t('hr.fields.schedule')} value={employment.schedule.name} />
            <Detail
              label={t('hr.fields.attendanceExempt')}
              value={employment.attendanceExempt ? t('hr.file.exempt') : t('hr.file.notExempt')}
            />
            <Detail
              label={t('hr.fields.remoteWeekdays')}
              value={
                remote.length > 0
                  ? formatList(remote.map((day) => t(`hr.weekdays.${day}`)))
                  : t('hr.file.noRemoteDays')
              }
            />
          </Details>
        </Card>
      </div>
      <ContractDialog
        file={file}
        open={editing}
        onClose={() => setEditing(false)}
        finalFocus={() => button.current ?? true}
      />
    </div>
  );
}

function PayTab({ file, self, live }: { file: EmployeeFile; self: boolean; live: boolean }) {
  const { t } = useTranslation();
  const me = useMe();
  const [editing, setEditing] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const pay = file.pay;
  if (!pay) return null;
  const managePayout = !self && live && can(me, 'payouts.manage');
  const method = pay.payoutMethod;
  return (
    <div className="flex flex-col gap-4">
      <TabHeader title={t('hr.file.tabs.pay')} description={t('hr.file.payHint')} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BanknoteIcon className="size-5 text-muted-foreground" />
              {t('hr.pay.current')}
            </CardTitle>
          </CardHeader>
          {pay.currentSalary ? (
            <div className="flex flex-col gap-1">
              <span dir="ltr" className="text-end text-2xl font-bold tabular-nums">
                {formatMoney(pay.currentSalary.amountMinor, pay.currentSalary.currency)}
              </span>
              <span className="text-sm text-muted-foreground">
                {t('hr.pay.since', { date: formatDate(pay.currentSalary.effectiveOn) })}
              </span>
            </div>
          ) : (
            <p className="text-muted-foreground">{t('hr.pay.noSalary')}</p>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <WalletIcon className="size-5 text-muted-foreground" />
              {t('hr.pay.payout')}
            </CardTitle>
            {managePayout && (
              <EditButton
                label={t('hr.pay.editPayout')}
                onClick={() => setEditing(true)}
                buttonRef={button}
              />
            )}
          </CardHeader>
          <Details>
            <Detail
              label={t('hr.fields.payoutMethod')}
              value={method && t(`hr.payoutMethods.${method}`)}
            />
            {method && method !== 'cash' && (
              <>
                <Detail label={t(`hr.payoutInstitution.${method}`)} value={pay.payoutInstitution} />
                <Detail label={t(`hr.payoutAccount.${method}`)} value={pay.payoutAccount} ltr />
                <Detail label={t('hr.fields.payoutHolder')} value={pay.payoutHolder} />
              </>
            )}
          </Details>
        </Card>
      </div>
      <SalaryHistory file={file} self={self} live={live} />
      <PayoutDialog
        file={file}
        open={editing}
        onClose={() => setEditing(false)}
        finalFocus={() => button.current ?? true}
      />
    </div>
  );
}

/** Rule A4: changes are added and archived with a reason, never edited. */
function SalaryHistory({ file, self, live }: { file: EmployeeFile; self: boolean; live: boolean }) {
  const { t } = useTranslation();
  const me = useMe();
  const history = useQuery(salaryChangesQuery(file.userId));
  const manage = !self && live && can(me, 'salaries.manage');
  const [adding, setAdding] = useState(false);
  const [archiving, setArchiving] = useState<SalaryChange | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const items = history.data?.items ?? [];

  const add = manage && (
    <Button ref={addButton} size="sm" onClick={() => setAdding(true)}>
      <PlusIcon />
      {t('hr.salary.add')}
    </Button>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle ref={heading} tabIndex={-1} className="text-lg">
          {t('hr.salary.history')}
        </CardTitle>
        {items.length > 0 && add}
      </CardHeader>
      {history.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : history.isError ? (
        <LoadError message={t('hr.salary.loadError')} onRetry={() => history.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BanknoteIcon />}
          title={t('hr.salary.emptyTitle')}
          description={manage ? t('hr.salary.emptyHint') : undefined}
          action={add}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((change) => (
            <li
              key={change.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    dir="ltr"
                    className={
                      change.archivedAt
                        ? 'font-medium text-muted-foreground tabular-nums line-through'
                        : 'font-medium tabular-nums'
                    }
                  >
                    {formatMoney(change.amountMinor, change.currency)}
                  </span>
                  {change.archivedAt && <Badge tone="neutral">{t('hr.salary.archived')}</Badge>}
                </div>
                <span className="text-sm text-muted-foreground">
                  {t('hr.salary.effective', { date: formatDate(change.effectiveOn) })} ·{' '}
                  {change.reason}
                </span>
                {change.archiveReason && (
                  <span className="text-sm text-muted-foreground">
                    {t('hr.salary.archiveReasonShown', { reason: change.archiveReason })}
                  </span>
                )}
              </div>
              {manage && !change.archivedAt && (
                <Button variant="ghost" size="sm" onClick={() => setArchiving(change)}>
                  <ArchiveIcon />
                  {t('hr.salary.archive')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <SalaryDialog
        userId={file.userId}
        open={adding}
        onClose={() => setAdding(false)}
        finalFocus={() => addButton.current ?? heading.current ?? true}
      />
      <ArchiveSalaryDialog
        change={archiving}
        onClose={() => setArchiving(null)}
        finalFocus={() => heading.current ?? true}
      />
    </Card>
  );
}

function Details({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col gap-3 text-sm">{children}</dl>;
}

function Detail({
  label,
  value,
  ltr,
}: {
  label: string;
  value: string | null | undefined;
  /** Shown with `dir="ltr"`: a phone, an account number. */
  ltr?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end">
        {value ? (
          <span dir={ltr ? 'ltr' : undefined} className="break-all">
            {value}
          </span>
        ) : (
          <span className="text-muted-foreground">{t('hr.file.notSet')}</span>
        )}
      </dd>
    </div>
  );
}

function FileSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-6 rounded-lg border border-border bg-surface p-6">
        <Skeleton className="size-20 rounded-full" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <Skeleton className="h-10 w-96 max-w-full" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}
