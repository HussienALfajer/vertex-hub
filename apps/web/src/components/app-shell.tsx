import { useQueryClient } from '@tanstack/react-query';
import { Link, type LinkProps, useRouter } from '@tanstack/react-router';
import type { MeResponse, Permission } from '@vertex-hub/contracts';
import {
  Avatar,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHeader,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  VertexMark,
} from '@vertex-hub/ui';
import {
  BriefcaseBusinessIcon,
  Building2Icon,
  ChevronDownIcon,
  CircleUserIcon,
  FolderKanbanIcon,
  LayoutTemplateIcon,
  ListTodoIcon,
  LogOutIcon,
  type LucideIcon,
  MenuIcon,
  MoonIcon,
  RepeatIcon,
  ScrollTextIcon,
  StampIcon,
  SunIcon,
  SwatchBookIcon,
  UsersIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { approvalTabsFor } from '../features/approvals/approvals-page';
import { NotificationBell } from '../features/notifications/notification-bell';
import { managesTeams } from '../features/tasks/task-access';
import { authClient, can, leaveSession, useMe } from '../lib/auth';
import { formatList } from '../lib/format';
import { useTheme } from '../lib/theme';

interface NavItem {
  to: LinkProps['to'];
  label:
    | 'nav.clients'
    | 'nav.tasks'
    | 'nav.approvals'
    | 'nav.projects'
    | 'nav.retainers'
    | 'nav.templates'
    | 'nav.team'
    | 'nav.departments'
    | 'nav.audit'
    | 'nav.designSystem';
  icon: LucideIcon;
  /** Hides the item from users without it. Cosmetic: the API enforces access. */
  permission?: Permission;
  /** Lists the item only for these users; others still reach the page. */
  show?: (me: MeResponse) => boolean;
  /** Active only on this exact path; otherwise also on its sub-pages (a profile under Team). */
  exact?: boolean;
  /** Pages of the section, listed under it. */
  children?: NavChild[];
}

interface NavChild {
  to: LinkProps['to'];
  label: 'nav.myTasks' | 'nav.taskList' | 'nav.taskBoard' | 'nav.workload';
  /** Lists the page only for these users; others still reach it. */
  show?: (me: MeResponse) => boolean;
}

const navItems: NavItem[] = [
  {
    to: '/tasks',
    label: 'nav.tasks',
    icon: ListTodoIcon,
    permission: 'tasks.read',
    children: [
      { to: '/tasks', label: 'nav.myTasks' },
      { to: '/tasks/list', label: 'nav.taskList' },
      { to: '/tasks/board', label: 'nav.taskBoard', show: managesTeams },
      { to: '/tasks/workload', label: 'nav.workload' },
    ],
  },
  // The queues of F09: listed for those with one to act on (screen 1).
  {
    to: '/approvals',
    label: 'nav.approvals',
    icon: StampIcon,
    show: (me) => approvalTabsFor(me).length > 0,
  },
  { to: '/clients', label: 'nav.clients', icon: BriefcaseBusinessIcon, permission: 'clients.read' },
  { to: '/projects', label: 'nav.projects', icon: FolderKanbanIcon, permission: 'projects.read' },
  { to: '/retainers', label: 'nav.retainers', icon: RepeatIcon, permission: 'projects.read' },
  // Everyone reads templates; the people who apply or maintain them see the link (F07 screen 1).
  { to: '/templates', label: 'nav.templates', icon: LayoutTemplateIcon, show: managesTeams },
  { to: '/team', label: 'nav.team', icon: UsersIcon },
  { to: '/departments', label: 'nav.departments', icon: Building2Icon },
  { to: '/audit', label: 'nav.audit', icon: ScrollTextIcon, permission: 'audit.read' },
  // A developer gallery (and the screenshot tests' page): listed in development only.
  {
    to: '/design-system',
    label: 'nav.designSystem',
    icon: SwatchBookIcon,
    exact: true,
    show: () => import.meta.env.DEV,
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const me = useMe();
  return (
    <div className="flex min-h-dvh bg-background">
      {/* Keyboard users skip the navigation on every page (WCAG 2.4.1). */}
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:start-4 focus-visible:top-4 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-surface focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-foreground focus-visible:shadow-float"
      >
        {t('nav.skip')}
      </a>
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 md:flex">
        <Sidebar me={me} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar me={me} />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 md:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

const navLink = cn(
  'relative flex items-center rounded-md text-sidebar-muted-foreground transition-colors duration-150 ease-out',
  'hover:bg-sidebar-hover hover:text-sidebar-foreground',
  'data-[status=active]:bg-sidebar-active data-[status=active]:font-medium data-[status=active]:text-sidebar-foreground',
  'before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:bg-sidebar-marker before:opacity-0 data-[status=active]:before:opacity-100',
);

/** A section with pages under it: the active page is marked, the section only brightens. */
const navSection = cn(
  'flex items-center rounded-md text-sidebar-muted-foreground transition-colors duration-150 ease-out',
  'hover:bg-sidebar-hover hover:text-sidebar-foreground',
  'data-[status=active]:font-medium data-[status=active]:text-sidebar-foreground',
);

/** Vertex Green navigation with the sand mark and a sand marker on the active item (§2, §7). */
function Sidebar({ me, onNavigate }: { me: MeResponse; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const items = navItems.filter(
    (item) => (!item.permission || can(me, item.permission)) && (!item.show || item.show(me)),
  );
  return (
    <div className="flex h-full w-full flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground [--ring:var(--sidebar-ring)]">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-5">
        <VertexMark className="w-8 text-sidebar-marker" />
        <span className="text-lg font-bold">{t('app.name')}</span>
      </div>
      {/* The links scroll under the fixed header on short screens and phones. */}
      <nav
        aria-label={t('nav.label')}
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3"
      >
        {items.map(({ to, label, icon: Icon, exact, children }) => (
          <div key={to} className="flex flex-col gap-1">
            <Link
              to={to}
              onClick={onNavigate}
              activeOptions={{ exact: exact ?? false }}
              className={cn(children ? navSection : navLink, 'h-10 gap-3 px-3 text-base')}
            >
              <Icon className="size-5" />
              {t(label)}
            </Link>
            {children && (
              <div className="flex flex-col gap-0.5">
                {children
                  .filter((child) => !child.show || child.show(me))
                  .map((child) => (
                    <Link
                      key={child.label}
                      to={child.to}
                      onClick={onNavigate}
                      activeOptions={{ exact: true, includeSearch: false }}
                      className={cn(navLink, 'h-8 ps-11 pe-3 text-sm')}
                    >
                      {t(child.label)}
                    </Link>
                  ))}
              </div>
            )}
          </div>
        ))}
      </nav>
    </div>
  );
}

function TopBar({ me }: { me: MeResponse }) {
  const { t } = useTranslation();
  const [navOpen, setNavOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-4 border-b border-border bg-surface px-4 md:px-8">
      <div className="flex items-center gap-2 md:invisible">
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetTrigger render={<Button variant="ghost" size="icon" aria-label={t('nav.open')} />}>
            <MenuIcon />
          </SheetTrigger>
          <SheetContent>
            <SheetTitle className="sr-only">{t('nav.label')}</SheetTitle>
            <Sidebar me={me} onNavigate={() => setNavOpen(false)} />
          </SheetContent>
        </Sheet>
        <VertexMark className="w-6 text-primary" label={t('app.brand')} />
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <NotificationBell />
        <UserMenu me={me} />
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const label = theme === 'dark' ? t('theme.toLight') : t('theme.toDark');
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={label} title={label}>
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}

function UserMenu({ me }: { me: MeResponse }) {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();

  async function signOut() {
    await authClient.signOut();
    await leaveSession(queryClient, () => router.navigate({ to: '/login' }));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="h-10 gap-2 px-2" aria-label={t('user.menu')} />}
      >
        <Avatar name={me.user.name} size="sm" className="size-8" />
        <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">
          {me.user.name}
        </span>
        <ChevronDownIcon className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuHeader>
          <span className="font-medium">{me.user.name}</span>
          <span dir="ltr" className="text-end text-sm text-muted-foreground">
            {me.user.email}
          </span>
          {me.roles.length > 0 && (
            <span className="mt-1 text-xs text-muted-foreground">
              {formatList(me.roles.map((role) => t(`roles.${role}`)))}
            </span>
          )}
        </DropdownMenuHeader>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/account" />}>
          <CircleUserIcon />
          {t('user.account')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={signOut}>
          <LogOutIcon className="rtl:-scale-x-100" />
          {t('user.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
