import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

interface CalendarGridProps extends ComponentProps<'div'> {
  /** The names of the seven days, in the order of the columns. */
  weekdays: readonly string[];
}

/**
 * Days laid out in seven columns under their weekday names: a month as rows of weeks, or a single
 * week. Flat cells divided by borders (§4); the columns follow the reading direction.
 */
function CalendarGrid({ weekdays, className, children, ...props }: CalendarGridProps) {
  return (
    <div
      data-slot="calendar-grid"
      className={cn('overflow-hidden rounded-lg border border-border bg-surface', className)}
      {...props}
    >
      <div aria-hidden="true" className="grid grid-cols-7 border-b border-border bg-muted">
        {weekdays.map((weekday) => (
          <span
            key={weekday}
            className="truncate px-2 py-1.5 text-xs font-medium text-muted-foreground"
          >
            {weekday}
          </span>
        ))}
      </div>
      <div className="-mb-px grid grid-cols-7">{children}</div>
    </div>
  );
}

interface CalendarDayProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** The day of the month as shown. */
  day: ReactNode;
  /** The full date, for assistive technology. */
  label: string;
  today?: boolean;
  /** A day of the previous or next month, shown to complete a week. */
  outside?: boolean;
  /** At the inline end of the day's heading: a count or a button. */
  action?: ReactNode;
}

/** One day of a `CalendarGrid`: its number, marked when it is today, then what happens on it. */
function CalendarDay({
  day,
  label,
  today = false,
  outside = false,
  action,
  className,
  children,
  ...props
}: CalendarDayProps) {
  return (
    <div
      data-slot="calendar-day"
      data-today={today || undefined}
      data-outside={outside || undefined}
      className={cn(
        'flex min-h-28 min-w-0 flex-col gap-1 border-e border-b border-border p-1.5 nth-[7n]:border-e-0',
        outside && 'bg-muted/50',
        className,
      )}
      {...props}
    >
      <div className="flex min-h-6 items-center justify-between gap-1">
        <span
          role="img"
          aria-label={label}
          className={cn(
            'flex h-6 min-w-6 items-center justify-center rounded-sm px-1 text-xs font-medium tabular-nums',
            today && 'bg-primary text-primary-foreground',
            !today && outside && 'text-muted-foreground',
          )}
        >
          {day}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

export { CalendarDay, type CalendarDayProps, CalendarGrid, type CalendarGridProps };
