import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type Responsibility,
  responsibilitySchema,
  type UserLink,
  type UserResponse,
} from '@vertex-hub/contracts';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AscentLines,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  PageHeader,
  Skeleton,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightIcon,
  BriefcaseBusinessIcon,
  Building2Icon,
  EllipsisIcon,
  FolderKanbanIcon,
  KeyRoundIcon,
  LinkIcon,
  ListTodoIcon,
  MailIcon,
  PencilIcon,
  PhoneIcon,
  ShieldOffIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UserXIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { LinkDialog } from './link-dialog';
import { TwoFactorIndicator, UserStatusBadge } from './user-badges';
import { UserForm } from './user-form';
import {
  useArchiveUser,
  useIssueLink,
  useResetTwoFactor,
  useRestoreUser,
  userQuery,
  useUpdateUser,
} from './users.queries';

export function UserProfilePage({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const user = useQuery(userQuery(userId));

  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/team" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('users.profile.back')}
        </Button>
      </div>
      {user.isPending ? (
        <ProfileSkeleton />
      ) : user.isError ? (
        user.error instanceof ApiError && user.error.status === 404 ? (
          <LoadError message={t('users.profile.notFound')} onRetry={() => user.refetch()} />
        ) : (
          <LoadError message={t('users.profile.loadError')} onRetry={() => user.refetch()} />
        )
      ) : (
        <Profile user={user.data} />
      )}
    </>
  );
}

function Profile({ user }: { user: UserResponse }) {
  const me = useMe();
  const [editing, setEditing] = useState(false);
  const manager = can(me, 'users.manage');
  // Only a General Manager changes a General Manager (F01 rule 5).
  const canChange =
    manager && (!user.roles?.includes('general_manager') || me.roles.includes('general_manager'));

  if (editing) return <EditUser user={user} onDone={() => setEditing(false)} />;

  return (
    <>
      <ProfileHero
        user={user}
        actions={canChange && <ProfileActions user={user} onEdit={() => setEditing(true)} />}
      />
      <Notices user={user} manager={manager} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <DepartmentsCard user={user} />
          <SkillsCard skills={user.skills} />
        </div>
        <div className="flex flex-col gap-6">
          <ContactCard user={user} />
          {manager && <AccountCard user={user} />}
        </div>
      </div>
    </>
  );
}

/** The person at a glance, with the 60° hairlines at the edge of the card (§5). */
function ProfileHero({ user, actions }: { user: UserResponse; actions: ReactNode }) {
  const { t } = useTranslation();
  const primary = user.departments.find((d) => d.isPrimary);
  return (
    <section className="relative flex flex-col gap-6 overflow-hidden rounded-lg border border-border bg-surface p-6 sm:flex-row sm:items-center">
      <AscentLines className="absolute inset-y-0 end-0 hidden h-full w-32 text-border md:block" />
      <Avatar
        name={user.name}
        size="xl"
        tone={user.status === 'archived' ? 'muted' : 'brand'}
        className="ring-4 ring-muted"
      />
      <div className="relative flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{user.name}</h1>
          {user.status && <UserStatusBadge status={user.status} />}
        </div>
        <p className="text-muted-foreground">
          {[user.title, primary?.name].filter(Boolean).join(' · ') || t('common.none')}
        </p>
      </div>
      {actions && <div className="relative flex shrink-0 items-center gap-2">{actions}</div>}
    </section>
  );
}

function Notices({ user, manager }: { user: UserResponse; manager: boolean }) {
  const { t } = useTranslation();
  const notices: { key: string; tone: 'warning' | 'info' | 'neutral'; text: string }[] = [];
  if (user.status === 'archived') {
    notices.push({ key: 'archived', tone: 'neutral', text: t('users.profile.archivedNotice') });
  } else {
    if (manager && user.status === 'invited') {
      notices.push({ key: 'invited', tone: 'info', text: t('users.profile.invitedNotice') });
    }
    if (manager && user.departments.length === 0) {
      notices.push({ key: 'legacy', tone: 'warning', text: t('users.profile.legacy') });
    }
  }
  if (notices.length === 0) return null;
  const tones = {
    warning: 'bg-status-warning text-status-warning-foreground',
    info: 'bg-status-info text-status-info-foreground',
    neutral: 'bg-status-neutral text-status-neutral-foreground',
  };
  return (
    <div className="flex flex-col gap-2">
      {notices.map((notice) => (
        <p
          key={notice.key}
          className={`flex items-center gap-2 rounded-md px-4 py-3 text-sm ${tones[notice.tone]}`}
        >
          <TriangleAlertIcon className="size-4 shrink-0" />
          {notice.text}
        </p>
      ))}
    </div>
  );
}

function DepartmentsCard({ user }: { user: UserResponse }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('users.profile.departments')}</CardTitle>
      </CardHeader>
      {user.departments.length === 0 ? (
        <p className="text-muted-foreground">{t('users.noDepartment')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {user.departments.map((department) => (
            <li key={department.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Building2Icon className="size-4" />
              </span>
              <Link
                to="/departments/$departmentId"
                params={{ departmentId: department.id }}
                className="flex-1 font-medium hover:underline"
              >
                {department.name}
              </Link>
              <div className="flex items-center gap-1.5">
                {department.isManager && <Badge tone="gold">{t('users.managerBadge')}</Badge>}
                <Badge tone={department.isPrimary ? 'brand' : 'outline'}>
                  {department.isPrimary
                    ? t('departments.detail.primary')
                    : t('departments.detail.secondary')}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SkillsCard({ skills }: { skills: string[] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <SparklesIcon className="size-5 text-muted-foreground" />
          {t('users.profile.skills')}
        </CardTitle>
      </CardHeader>
      {skills.length === 0 ? (
        <p className="text-muted-foreground">{t('users.profile.noSkills')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {skills.map((skill) => (
            <Badge key={skill} tone="neutral" className="h-7 px-3 text-sm">
              {skill}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

function ContactCard({ user }: { user: UserResponse }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('users.profile.contact')}</CardTitle>
      </CardHeader>
      <dl className="flex flex-col gap-3 text-sm">
        {user.email && (
          <ContactRow icon={<MailIcon />} label={t('users.form.email')}>
            <a dir="ltr" href={`mailto:${user.email}`} className="break-all hover:underline">
              {user.email}
            </a>
          </ContactRow>
        )}
        <ContactRow icon={<PhoneIcon />} label={t('users.form.phone')}>
          {user.phone ? (
            <a dir="ltr" href={`tel:${user.phone}`} className="hover:underline">
              {user.phone}
            </a>
          ) : (
            <span className="text-muted-foreground">{t('users.profile.noPhone')}</span>
          )}
        </ContactRow>
      </dl>
    </Card>
  );
}

function ContactRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <div className="flex min-w-0 flex-col">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}

function AccountCard({ user }: { user: UserResponse }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('users.profile.account')}</CardTitle>
      </CardHeader>
      <dl className="flex flex-col gap-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t('users.status')}</dt>
          <dd>{user.status && <UserStatusBadge status={user.status} />}</dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground">{t('users.profile.roles')}</dt>
          <dd className="flex flex-wrap justify-end gap-1">
            {user.roles?.length ? (
              user.roles.map((role) => (
                <Badge key={role} tone={role === 'general_manager' ? 'brand' : 'outline'}>
                  {t(`roles.${role}`)}
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground">{t('users.profile.noRoles')}</span>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t('users.profile.twoFactor')}</dt>
          <dd className="flex items-center gap-2">
            <TwoFactorIndicator enabled={user.twoFactorEnabled ?? false} />
            {user.twoFactorEnabled ? t('account.twoFactor.on') : t('account.twoFactor.off')}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

type Confirming = 'archive' | 'restore' | 'resetTwoFactor' | null;

function ProfileActions({ user, onEdit }: { user: UserResponse; onEdit: () => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const issueLink = useIssueLink(user.id);
  const [link, setLink] = useState<UserLink | null>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const archived = user.status === 'archived';

  async function copyLink() {
    try {
      setLink(await issueLink.mutateAsync());
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  return (
    <>
      {!archived && (
        <Button variant="outline" onClick={onEdit}>
          <PencilIcon />
          {t('users.profile.edit')}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="icon" aria-label={t('users.profile.actions')} />}
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-64">
          {archived ? (
            <DropdownMenuItem onClick={() => setConfirming('restore')}>
              <ArchiveRestoreIcon />
              {t('users.profile.restore')}
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onClick={copyLink} disabled={issueLink.isPending}>
                {user.status === 'invited' ? <LinkIcon /> : <KeyRoundIcon />}
                {user.status === 'invited'
                  ? t('users.profile.issueActivation')
                  : t('users.profile.issueReset')}
              </DropdownMenuItem>
              {user.twoFactorEnabled && (
                <DropdownMenuItem onClick={() => setConfirming('resetTwoFactor')}>
                  <ShieldOffIcon />
                  {t('users.profile.resetTwoFactor')}
                </DropdownMenuItem>
              )}
              {user.id !== me.user.id && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setConfirming('archive')}>
                    <ArchiveIcon />
                    {t('users.profile.archive')}
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <LinkDialog link={link} name={user.name} onClose={() => setLink(null)} />
      <ArchiveDialog
        user={user}
        open={confirming === 'archive'}
        onClose={() => setConfirming(null)}
      />
      <RestoreDialog
        user={user}
        open={confirming === 'restore'}
        onClose={() => setConfirming(null)}
        onRestored={setLink}
      />
      <ResetTwoFactorDialog
        user={user}
        open={confirming === 'resetTwoFactor'}
        onClose={() => setConfirming(null)}
      />
    </>
  );
}

const responsibilitiesSchema = responsibilitySchema.array();

function ArchiveDialog({
  user,
  open,
  onClose,
}: {
  user: UserResponse;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const archive = useArchiveUser(user.id);
  const [blockers, setBlockers] = useState<Responsibility[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  function close() {
    setBlockers(null);
    setFailure(null);
    archive.reset();
    onClose();
  }

  async function confirm() {
    setFailure(null);
    try {
      await archive.mutateAsync();
      toast.add({ title: t('users.confirm.archived'), type: 'success' });
      close();
    } catch (error) {
      const parsed =
        error instanceof ApiError && error.code === 'USER_HAS_RESPONSIBILITIES'
          ? responsibilitiesSchema.safeParse(error.details)
          : null;
      if (parsed?.success) setBlockers(parsed.data);
      else setFailure(errorMessage(t, error));
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && close()}>
      <AlertDialogContent>
        {blockers ? (
          <>
            <AlertDialogHeader>
              <div className="mb-2 flex size-11 items-center justify-center rounded-lg bg-status-warning text-status-warning-foreground">
                <UserXIcon className="size-5" />
              </div>
              <AlertDialogTitle>{t('users.responsibilities.title')}</AlertDialogTitle>
              <AlertDialogDescription>{t('users.responsibilities.body')}</AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="flex flex-col gap-2">
              {blockers.map((item) => (
                <li
                  key={`${item.type}-${item.id}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  <span className="flex items-center gap-2 text-sm">
                    {item.type === 'manages_department' ? (
                      <Building2Icon className="size-4 text-muted-foreground" />
                    ) : item.type === 'account_manager_of_client' ? (
                      <BriefcaseBusinessIcon className="size-4 text-muted-foreground" />
                    ) : item.type === 'assignee_of_open_tasks' ? (
                      <ListTodoIcon className="size-4 text-muted-foreground" />
                    ) : (
                      <FolderKanbanIcon className="size-4 text-muted-foreground" />
                    )}
                    {t(`users.responsibilities.${item.type}`, { name: item.name })}
                  </span>
                  {item.type === 'manages_department' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      render={
                        <Link to="/departments/$departmentId" params={{ departmentId: item.id }} />
                      }
                    >
                      {t('users.responsibilities.open')}
                    </Button>
                  ) : item.type === 'account_manager_of_client' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      render={<Link to="/clients/$clientId" params={{ clientId: item.id }} />}
                    >
                      {t('users.responsibilities.openClient')}
                    </Button>
                  ) : item.type === 'project_manager_of_project' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      render={<Link to="/projects/$projectId" params={{ projectId: item.id }} />}
                    >
                      {t('users.responsibilities.openProject')}
                    </Button>
                  ) : item.type === 'assignee_of_open_tasks' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      render={<Link to="/tasks/$taskId" params={{ taskId: item.id }} />}
                    >
                      {t('users.responsibilities.openTask')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>
                {t('common.close')}
              </AlertDialogClose>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('users.confirm.archiveTitle', { name: user.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>{t('users.confirm.archiveBody')}</AlertDialogDescription>
            </AlertDialogHeader>
            {failure && <FormAlert>{failure}</FormAlert>}
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>
                {t('common.cancel')}
              </AlertDialogClose>
              <Button variant="destructive" onClick={confirm} disabled={archive.isPending}>
                {t('users.confirm.archiveAction')}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RestoreDialog({
  user,
  open,
  onClose,
  onRestored,
}: {
  user: UserResponse;
  open: boolean;
  onClose: () => void;
  onRestored: (link: UserLink) => void;
}) {
  const { t } = useTranslation();
  const restore = useRestoreUser(user.id);
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t('users.confirm.restoreTitle', { name: user.name })}
      body={t('users.confirm.restoreBody')}
      action={t('users.confirm.restoreAction')}
      pending={restore.isPending}
      onConfirm={async () => onRestored((await restore.mutateAsync()).link)}
    />
  );
}

function ResetTwoFactorDialog({
  user,
  open,
  onClose,
}: {
  user: UserResponse;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const reset = useResetTwoFactor(user.id);
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t('users.confirm.resetTitle')}
      body={t('users.confirm.resetBody', { name: user.name })}
      action={t('users.confirm.resetAction')}
      destructive
      pending={reset.isPending}
      onConfirm={async () => {
        await reset.mutateAsync();
        toast.add({ title: t('users.confirm.resetDone'), type: 'success' });
      }}
    />
  );
}

function EditUser({ user, onDone }: { user: UserResponse; onDone: () => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const update = useUpdateUser(user.id);
  const primary = user.departments.find((d) => d.isPrimary);
  return (
    <>
      <PageHeader
        title={t('users.profile.editTitle', { name: user.name })}
        description={t('users.profile.editHint')}
      />
      <UserForm
        defaultValues={{
          name: user.name,
          email: user.email ?? '',
          primaryDepartmentId: primary?.id ?? '',
          secondaryDepartmentIds: user.departments.filter((d) => !d.isPrimary).map((d) => d.id),
          title: user.title ?? '',
          phone: user.phone ?? '',
          skills: user.skills,
          roles: user.roles ?? [],
        }}
        canGrantGeneralManager={me.roles.includes('general_manager')}
        submitLabel={t('users.form.save')}
        submittingLabel={t('common.saving')}
        onSubmit={async (values) => {
          await update.mutateAsync(values);
          toast.add({ title: t('users.profile.updated'), type: 'success' });
          onDone();
        }}
        actions={
          <Button variant="outline" onClick={onDone}>
            {t('common.cancel')}
          </Button>
        }
      />
    </>
  );
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-6 rounded-lg border border-border bg-surface p-6">
        <Skeleton className="size-20 rounded-full" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-48 lg:col-span-2" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}
