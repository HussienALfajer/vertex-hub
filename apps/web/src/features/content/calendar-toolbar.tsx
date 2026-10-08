import type { CalendarDate } from '@vertex-hub/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  IconButton,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCalendarDate, formatMonth, formatNumber, formatWeekdayDate } from '../../lib/format';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { type CalendarView, calendarRange, shiftCalendar } from './content-dates';

/*
 * What the content calendar (F08) and the company calendar (F11) share: the bar that moves
 * through months and weeks, and the list of a day too full for its cell.
 */

/** Back, forward and today, the month or the week shown, and the month or week switch. */
export function CalendarToolbar({
  view,
  date,
  onChange,
}: {
  view: CalendarView;
  date: CalendarDate;
  /** `date` unset means today; `view` unset means the month. */
  onChange: (next: { date?: CalendarDate; view?: 'week' }) => void;
}) {
  const { t } = useTranslation();
  const range = calendarRange(view, date);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <IconButton
          variant="outline"
          size="icon"
          label={t(`calendar.previous.${view}`)}
          onClick={() => onChange({ date: shiftCalendar(view, date, -1) })}
        >
          <ChevronRightIcon className="ltr:-scale-x-100" />
        </IconButton>
        <IconButton
          variant="outline"
          size="icon"
          label={t(`calendar.next.${view}`)}
          onClick={() => onChange({ date: shiftCalendar(view, date, 1) })}
        >
          <ChevronLeftIcon className="ltr:-scale-x-100" />
        </IconButton>
        <Button variant="outline" onClick={() => onChange({ date: undefined })}>
          {t('calendar.today')}
        </Button>
      </div>
      <h2 className="text-lg font-bold tabular-nums" aria-live="polite">
        {view === 'month'
          ? formatMonth(date)
          : t('calendar.weekRange', {
              from: formatCalendarDate(range.from),
              to: formatCalendarDate(range.to),
            })}
      </h2>
      <ToggleGroup
        aria-label={t('calendar.view')}
        className="ms-auto"
        value={[view]}
        onValueChange={(next: CalendarView[]) => {
          if (next[0]) onChange({ view: next[0] === 'week' ? 'week' : undefined });
        }}
      >
        <ToggleGroupItem value="month">{t('calendar.views.month')}</ToggleGroupItem>
        <ToggleGroupItem value="week">{t('calendar.views.week')}</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

/** "+n" under a full day of the month grid: opens the day's list. */
export function MoreOnDay({
  day,
  count,
  onOpen,
}: {
  day: CalendarDate;
  count: number;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 justify-start px-1.5 text-xs"
      aria-label={t('calendar.moreOn', { n: formatNumber(count), date: formatWeekdayDate(day) })}
      onClick={onOpen}
    >
      <span dir="ltr">{t('calendar.more', { n: formatNumber(count) })}</span>
    </Button>
  );
}

/**
 * Everything on one day, opened from its "+n". It stays mounted, so it fades out with its list
 * and gives the focus back to the "+n" that opened it.
 */
export function DayDialog({
  day,
  onClose,
  children,
}: {
  /** The day shown; null while closed. */
  day: CalendarDate | null;
  onClose: () => void;
  children: (day: CalendarDate) => ReactNode;
}) {
  const { t } = useTranslation();
  const shown = useShownWhileClosing(day);
  if (!shown) return null;
  return (
    <Dialog open={day !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{formatWeekdayDate(shown)}</DialogTitle>
        </DialogHeader>
        {children(shown)}
      </DialogContent>
    </Dialog>
  );
}
