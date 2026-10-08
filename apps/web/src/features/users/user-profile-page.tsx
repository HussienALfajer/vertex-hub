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
  Callout,
  Card,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconTile,
  PageHeader,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightIcon,
  BriefcaseBusinessIcon,
  Building2Icon,
  CalendarDaysIcon,
  CameraIcon,
  EllipsisIcon,
  FolderKanbanIcon,
  KeyRoundIcon,
  LinkIcon,
  ListTodoIcon,
  type LucideIcon,
  MailIcon,
  PencilIcon,
  PhoneIcon,
  ShieldOffIcon,
  SparklesIcon,
  TargetIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
  UserXIcon,
} from 'lucide-react';
import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { isMissing, LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatList } from '../../lib/format';
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
        isMissing(user.error) ? (
          <LoadError
            message={t('users.profile.notFound')}
            onRetry={() => user.refetch()}
            error={user.error}
          />
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
  const editButton = useRef<HTMLButtonElement>(null);
  const leftForm = useRef(false);
  const manager = can(me, 'users.manage');
  // Only a General Manager changes a General Manager (F01 rule 5).
  const canChange =
    manager && (!user.roles?.includes('general_manager') || me.roles.includes('general_manager'));

  // The form replaces the profile, so leaving it would drop the focus on the page body.
  useEffect(() => {
    if (editing || !leftForm.current) return;
    leftForm.current = false;
    editButton.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <EditUser
        user={user}
        onDone={() => {
          leftForm.current = true;
          setEditing(false);
        }}
      />
    );
  }

  return (
    <>
      <ProfileHero
        user={user}
        actions={
          canChange && (
            <ProfileActions user={user} editButton={editButton} onEdit={() => setEditing(true)} />
          )
        }
      />
      <Notices user={user} manager={manager} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
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
  if (user.status === 'archived') {
    return (
      <Callout tone="neutral" icon={<ArchiveIcon />} title={t('users.profile.archivedNotice')} />
    );
  }
  if (!manager) return null;
  return (
    <>
      {user.status === 'invited' && (
        <Callout tone="info" icon={<MailIcon />} title={t('users.profile.invitedNotice')} />
      )}
      {user.departments.length === 0 && (
        <Callout tone="warning" icon={<TriangleAlertIcon />} title={t('users.profile.legacy')} />
      )}
    </>
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

function ProfileActions({
  user,
  editButton,
  onEdit,
}: {
  user: UserResponse;
  editButton: RefObject<HTMLButtonElement | null>;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  // Every dialog here gives the focus back to the menu button, also the link dialog that the
  // restore confirmation opens (else the focus goes back to the confirmation, which is gone).
  const menuButton = useRef<HTMLButtonElement>(null);
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
        <Button ref={editButton} variant="outline" onClick={onEdit}>
          <PencilIcon />
          {t('users.profile.edit')}
        </Button>
      )}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    ref={menuButton}
                    variant="outline"
                    size="icon"
                    aria-label={t('users.profile.actions')}
                  />
                }
              />
            }
          >
            <EllipsisIcon />
          </TooltipTrigger>
          <TooltipContent>{t('users.profile.actions')}</TooltipContent>
        </Tooltip>
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

      <LinkDialog
        link={link}
        name={user.name}
        email={user.email}
        onClose={() => setLink(null)}
        finalFocus={menuButton}
      />
      <ArchiveDialog
        user={user}
        open={confirming === 'archive'}
        onClose={() => setConfirming(null)}
        finalFocus={menuButton}
      />
      <RestoreDialog
        user={user}
        open={confirming === 'restore'}
        onClose={() => setConfirming(null)}
        onRestored={setLink}
        finalFocus={menuButton}
      />
      <ResetTwoFactorDialog
        user={user}
        open={confirming === 'resetTwoFactor'}
        onClose={() => setConfirming(null)}
        finalFocus={menuButton}
      />
    </>
  );
}

const responsibilitiesSchema = responsibilitySchema.array();

/** How each responsibility that blocks archiving shows: its icon and the page to fix it on. */
const responsibilityViews = {
  manages_department: {
    icon: Building2Icon,
    open: 'users.responsibilities.open',
    link: (id: string) => <Link to="/departments/$departmentId" params={{ departmentId: id }} />,
  },
  account_manager_of_client: {
    icon: BriefcaseBusinessIcon,
    open: 'users.responsibilities.openClient',
    link: (id: string) => <Link to="/clients/$clientId" params={{ clientId: id }} />,
  },
  project_manager_of_project: {
    icon: FolderKanbanIcon,
    open: 'users.responsibilities.openProject',
    link: (id: string) => <Link to="/projects/$projectId" params={{ projectId: id }} />,
  },
  assignee_of_open_tasks: {
    icon: ListTodoIcon,
    open: 'users.responsibilities.openTask',
    link: (id: string) => <Link to="/tasks/$taskId" params={{ taskId: id }} />,
  },
  responsible_for_open_posts: {
    icon: CalendarDaysIcon,
    open: 'users.responsibilities.openPost',
    link: (id: string) => <Link to="/content/posts/$postId" params={{ postId: id }} />,
  },
  lead_of_scheduled_shoots: {
    icon: CameraIcon,
    open: 'users.responsibilities.openShoot',
    link: (id: string) => <Link to="/shoots/$shootId" params={{ shootId: id }} />,
  },
  organizer_of_upcoming_meetings: {
    icon: UsersRoundIcon,
    open: 'users.responsibilities.openMeeting',
    link: (id: string) => <Link to="/meetings/$meetingId" params={{ meetingId: id }} />,
  },
  owner_of_open_leads: {
    icon: TargetIcon,
    open: 'users.responsibilities.openLead',
    link: (id: string) => <Link to="/leads/$leadId" params={{ leadId: id }} />,
  },
} as const satisfies Record<
  Responsibility['type'],
  { icon: LucideIcon; open: string; link: (id: string) => ReactElement }
>;

/** The responsibilities a refusal lists (`USER_HAS_RESPONSIBILITIES` and similar), if any. */
function blockersOf(error: unknown): Responsibility[] | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code !== 'USER_HAS_RESPONSIBILITIES' && error.code !== 'MANAGER_MEMBERSHIP_REQUIRED') {
    return null;
  }
  const parsed = responsibilitiesSchema.safeParse(error.details);
  return parsed.success && parsed.data.length > 0 ? parsed.data : null;
}

/** The element a dialog gives the focus back to when it closes. */
type FinalFocus = RefObject<HTMLElement | null>;

function ArchiveDialog({
  user,
  open,
  onClose,
  finalFocus,
}: {
  user: UserResponse;
  open: boolean;
  onClose: () => void;
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const archive = useArchiveUser(user.id);
  const [blockers, setBlockers] = useState<Responsibility[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const blockersTitle = useRef<HTMLHeadingElement>(null);

  // The archive button that had the focus is gone once the list shows: read the new title.
  useEffect(() => {
    if (blockers) blockersTitle.current?.focus();
  }, [blockers]);

  // After the exit animation, so the dialog does not flip back to the question while it fades.
  function reset() {
    setBlockers(null);
    setFailure(null);
    archive.reset();
  }

  async function confirm() {
    setFailure(null);
    try {
      await archive.mutateAsync();
      toast.add({ title: t('users.confirm.archived'), type: 'success' });
      onClose();
    } catch (error) {
      const found = blockersOf(error);
      if (found) setBlockers(found);
      else setFailure(errorMessage(t, error));
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onOpenChangeComplete={(next) => !next && reset()}
    >
      <AlertDialogContent finalFocus={finalFocus}>
        {blockers ? (
          <>
            <AlertDialogHeader>
              <IconTile tone="warning" className="mb-2">
                <UserXIcon />
              </IconTile>
              <AlertDialogTitle ref={blockersTitle} tabIndex={-1} className="outline-none">
                {t('users.responsibilities.title')}
              </AlertDialogTitle>
              <AlertDialogDescription>{t('users.responsibilities.body')}</AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="flex flex-col gap-2">
              {blockers.map((item) => {
                const view = responsibilityViews[item.type];
                return (
                  <li
                    key={`${item.type}-${item.id}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <view.icon className="size-4 shrink-0 text-muted-foreground" />
                      {t(`users.responsibilities.${item.type}`, { name: item.name })}
                    </span>
                    <Button size="sm" variant="outline" render={view.link(item.id)}>
                      {t(view.open)}
                    </Button>
                  </li>
                );
              })}
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
  finalFocus,
}: {
  user: UserResponse;
  open: boolean;
  onClose: () => void;
  onRestored: (link: UserLink) => void;
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const restore = useRestoreUser(user.id);
  // After a restore the link dialog opens and takes the focus; this one closes after it and must
  // not pull the focus back behind it.
  const handedOver = useRef(false);
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t('users.confirm.restoreTitle', { name: user.name })}
      body={t('users.confirm.restoreBody')}
      action={t('users.confirm.restoreAction')}
      pending={restore.isPending}
      finalFocus={() => {
        const target = handedOver.current ? false : finalFocus.current;
        handedOver.current = false;
        return target;
      }}
      onConfirm={async () => {
        const { link } = await restore.mutateAsync();
        handedOver.current = true;
        onRestored(link);
      }}
    />
  );
}

function ResetTwoFactorDialog({
  user,
  open,
  onClose,
  finalFocus,
}: {
  user: UserResponse;
  open: boolean;
  onClose: () => void;
  finalFocus: FinalFocus;
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
      finalFocus={finalFocus}
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
        ownAccount={user.id === me.user.id}
        submitLabel={t('users.form.save')}
        submittingLabel={t('common.saving')}
        describeFailure={(error) => {
          const blockers = blockersOf(error);
          if (!blockers) return;
          return t('users.form.blockedBy', {
            message: errorMessage(t, error),
            items: formatList(
              blockers.map((item) => t(`users.responsibilities.${item.type}`, { name: item.name })),
            ),
          });
        }}
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
