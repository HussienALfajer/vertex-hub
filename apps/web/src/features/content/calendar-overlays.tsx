import type { CalendarDate, CalendarOccasion } from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  cn,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
  toast,
} from '@vertex-hub/ui';
import { CalendarHeartIcon, CalendarOffIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errors';
import { formatCalendarDate, formatNumber } from '../../lib/format';
import { occasionUncovered } from './calendar-marks';
import { useSkipOccasion, useUnskipOccasion } from './content.queries';

/*
 * The planning marks on the content calendar's days (spec F08B, screen 2): an occasion's strip on
 * its days, warning on a client's calendar while no post carries it (rule C6), and the dotted
 * mark of a gap day (rule C7).
 */

/**
 * An occasion on one of its days: its name as a strip that opens its dates and coverage. On a
 * client's calendar an uncovered occasion warns "No post planned" and edit-scope users may say
 * "No post this year" (or undo it).
 */
export function OccasionStrip({
  occasion,
  day,
  clientId,
  canSkip,
}: {
  occasion: CalendarOccasion;
  day: CalendarDate;
  clientId?: string;
  canSkip: boolean;
}) {
  const { t } = useTranslation();
  const uncovered = occasionUncovered(occasion);
  const first = day === occasion.startDate;
  return (
    <Popover>
      <PopoverTrigger
        data-occasion={occasion.id}
        data-uncovered={uncovered || undefined}
        className={cn(
          'flex min-w-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-start text-xs font-medium',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          uncovered
            ? 'bg-status-warning text-status-warning-foreground'
            : 'bg-status-gold text-status-gold-foreground',
        )}
      >
        <CalendarHeartIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">
          {first && uncovered
            ? t('content.occasions.stripUncovered', { name: occasion.name })
            : occasion.name}
        </span>
      </PopoverTrigger>
      <PopoverContent className="gap-3 p-4">
        <PopoverTitle className="text-base font-bold">{occasion.name}</PopoverTitle>
        <OccasionFacts occasion={occasion} />
        {clientId && canSkip && occasion.covered === false && (
          <SkipButton occasion={occasion} clientId={clientId} />
        )}
      </PopoverContent>
    </Popover>
  );
}

function OccasionFacts({ occasion }: { occasion: CalendarOccasion }) {
  const { t } = useTranslation();
  const dates =
    occasion.startDate === occasion.endDate
      ? formatCalendarDate(occasion.startDate)
      : t('content.occasions.range', {
          from: formatCalendarDate(occasion.startDate),
          to: formatCalendarDate(occasion.endDate),
        });
  return (
    <div className="flex flex-col gap-2 text-sm">
      <span className="tabular-nums">{dates}</span>
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge tone="outline">{t(`content.occasions.categories.${occasion.category}`)}</Badge>
        <Badge tone={occasion.confirmed ? 'success' : 'neutral'}>
          {occasion.confirmed ? t('content.occasions.confirmed') : t('content.occasions.computed')}
        </Badge>
        {occasion.covered === true && (
          <Badge tone="success">{t('content.occasions.covered')}</Badge>
        )}
        {occasion.covered === false &&
          (occasion.skipped ? (
            <Badge tone="neutral">{t('content.occasions.skipped')}</Badge>
          ) : (
            <Badge tone="warning">{t('content.occasions.uncovered')}</Badge>
          ))}
      </span>
      {occasion.covered === false && !occasion.skipped && (
        <p className="text-muted-foreground">
          {t('content.occasions.uncoveredHint', { n: formatNumber(occasion.leadDays) })}
        </p>
      )}
    </div>
  );
}

/** Rule C6: "No post this year" silences the hint for the occurrence's year; undo restores it. */
function SkipButton({ occasion, clientId }: { occasion: CalendarOccasion; clientId: string }) {
  const { t } = useTranslation();
  const skip = useSkipOccasion(clientId);
  const unskip = useUnskipOccasion(clientId);
  const year = Number(occasion.startDate.slice(0, 4));
  const pending = skip.isPending || unskip.isPending;
  async function toggle() {
    try {
      const input = { occasionId: occasion.id, year };
      if (occasion.skipped) await unskip.mutateAsync(input);
      else await skip.mutateAsync(input);
      toast.add({
        title: occasion.skipped
          ? t('content.occasions.unskipped')
          : t('content.occasions.skippedDone'),
        type: 'success',
      });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }
  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => void toggle()}>
      <CalendarOffIcon />
      {occasion.skipped ? t('content.occasions.unskip') : t('content.occasions.skip')}
    </Button>
  );
}

/**
 * Rule C7: a day inside a run longer than the client's rhythm without a post. On the calendar of
 * every client it names the clients concerned.
 */
export function GapMark({ clients }: { clients: string[] }) {
  const { t } = useTranslation();
  const names = clients.filter(Boolean);
  return (
    <span
      data-gap
      className="mt-auto rounded-sm border border-dashed border-status-warning-foreground px-1.5 py-0.5 text-xs text-muted-foreground"
    >
      {names.length > 0
        ? t('content.planning.gapFor', { names: names.join('، ') })
        : t('content.planning.gapDay')}
    </span>
  );
}
