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
  Building2Icon,
  ChevronDownIcon,
  CircleUserIcon,
  HouseIcon,
  LogOutIcon,
  type LucideIcon,
  MenuIcon,
  MoonIcon,
  ScrollTextIcon,
  SunIcon,
  SwatchBookIcon,
  UsersIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authClient, can, useMe } from '../lib/auth';
import { useTheme } from '../lib/theme';

interface NavItem {
  to: LinkProps['to'];
  label: 'nav.home' | 'nav.team' | 'nav.departments' | 'nav.audit' | 'nav.designSystem';
  icon: LucideIcon;
  /** Hides the item from users without it. Cosmetic: the API enforces access. */
  permission?: Permission;
  /** Active only on this exact path; otherwise also on its sub-pages (a profile under Team). */
  exact?: boolean;
}

const navItems: NavItem[] = [
  { to: '/', label: 'nav.home', icon: HouseIcon, exact: true },
  { to: '/team', label: 'nav.team', icon: UsersIcon },
  { to: '/departments', label: 'nav.departments', icon: Building2Icon },
  { to: '/audit', label: 'nav.audit', icon: ScrollTextIcon, permission: 'audit.read' },
  { to: '/design-system', label: 'nav.designSystem', icon: SwatchBookIcon, exact: true },
];

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 md:flex">
        <Sidebar me={me} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar me={me} />
        <main className="flex-1">
          <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 md:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** Vertex Green navigation with the sand mark and a sand marker on the active item (§2, §7). */
function Sidebar({ me, onNavigate }: { me: MeResponse; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const items = navItems.filter((item) => !item.permission || can(me, item.permission));
  return (
    <div className="flex h-full w-full flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground [--ring:var(--sidebar-ring)]">
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-5">
        <VertexMark className="w-8 text-sidebar-marker" />
        <span className="text-lg font-bold">{t('app.name')}</span>
      </div>
      <nav aria-label={t('nav.label')} className="flex flex-col gap-1 p-3">
        {items.map(({ to, label, icon: Icon, exact }) => (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            activeOptions={{ exact: exact ?? false }}
            className={cn(
              'relative flex h-10 items-center gap-3 rounded-md px-3 text-base text-sidebar-muted-foreground transition-colors duration-150 ease-out',
              'hover:bg-sidebar-hover hover:text-sidebar-foreground',
              'data-[status=active]:bg-sidebar-active data-[status=active]:font-medium data-[status=active]:text-sidebar-foreground',
              'before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:bg-sidebar-marker before:opacity-0 data-[status=active]:before:opacity-100',
            )}
          >
            <Icon className="size-5" />
            {t(label)}
          </Link>
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
    queryClient.clear();
    await router.navigate({ to: '/login' });
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
              {me.roles.map((role) => t(`roles.${role}`)).join('، ')}
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
