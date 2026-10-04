import type { UseQueryResult } from '@tanstack/react-query';
import { Link, type LinkProps } from '@tanstack/react-router';
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  cn,
  EmptyState,
  Skeleton,
} from '@vertex-hub/ui';
import { ArrowLeftIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';

/**
 * One section of the home page (rule 7): it loads on its own and shows its own loading, error and
 * empty states. Sections fold, so a phone reaches the one it needs (screen 1).
 */
export function DashboardSection<T>({
  id,
  title,
  icon: Icon,
  query,
  loadError,
  isEmpty,
  empty,
  actions,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  query: UseQueryResult<T>;
  loadError: string;
  /** The answer has nothing to show: the `empty` state replaces the content. */
  isEmpty?: (data: T) => boolean;
  empty?: { icon: ReactNode; title: string; description?: string };
  /** Controls in the section's heading row (a department picker). */
  actions?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const titleId = `dashboard-${id}`;
  return (
    <section aria-labelledby={titleId} className="rounded-lg border border-border bg-surface">
      <Collapsible defaultOpen>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-6">
          {/* The trigger inside the heading keeps the heading for screen readers (accordion). */}
          <h2 id={titleId} className="min-w-0 flex-1 text-lg font-bold">
            <CollapsibleTrigger className="py-1">
              <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
              {title}
            </CollapsibleTrigger>
          </h2>
          {actions}
        </div>
        <CollapsiblePanel className="gap-4 border-t border-border p-4 md:p-6">
          {query.isPending ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {['a', 'b', 'c', 'd'].map((key) => (
                <Skeleton key={key} className="h-24" />
              ))}
            </div>
          ) : query.isError ? (
            <LoadError message={loadError} onRetry={() => query.refetch()} />
          ) : isEmpty?.(query.data) && empty ? (
            <EmptyState icon={empty.icon} title={empty.title} description={empty.description} />
          ) : (
            children(query.data)
          )}
        </CollapsiblePanel>
      </Collapsible>
    </section>
  );
}

/** A figure with its label, an optional comparison line and a link to the screen behind it. */
export function StatCard({
  label,
  value,
  detail,
  link,
  alert,
  className,
}: {
  label: string;
  value: ReactNode;
  /** Under the figure: last month's value, the per-currency split. */
  detail?: ReactNode;
  link?: { to: LinkProps['to']; search?: LinkProps['search']; label: string };
  /** Needs attention: the figure turns to the danger tone. */
  alert?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-background p-4',
        className,
      )}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn('text-2xl font-bold tabular-nums', alert && 'text-destructive-text')}>
        {value}
      </span>
      {detail && <div className="text-sm text-muted-foreground">{detail}</div>}
      {link && <SeeLink {...link} className="mt-auto pt-2" />}
    </div>
  );
}

/** "Open …" to the filtered screen behind a figure. */
export function SeeLink({
  to,
  search,
  params,
  label,
  className,
}: {
  to: LinkProps['to'];
  search?: LinkProps['search'];
  params?: LinkProps['params'];
  label: string;
  className?: string;
}) {
  return (
    <Link
      to={to}
      search={search}
      params={params}
      className={cn(
        'flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-primary outline-offset-2 hover:underline',
        className,
      )}
    >
      {label}
      <ArrowLeftIcon aria-hidden="true" className="size-4 ltr:-scale-x-100" />
    </Link>
  );
}

/** Last month's value beside this month's (rule 6). */
export function LastMonth({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap items-baseline gap-1">
      {t('dashboard.lastMonth')}
      <span className="font-medium text-foreground tabular-nums">{children}</span>
    </span>
  );
}

/** A small heading inside a section, above a group of cards or a list. */
export function SubHeading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="text-base font-bold">
      {children}
    </h3>
  );
}
