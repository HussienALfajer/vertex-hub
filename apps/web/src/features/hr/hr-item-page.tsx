import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ATTENDANCE_ITEM_LIMITS,
  type AttendanceItem,
  type AttendanceItemDetail,
  ITEM_DECISIONS_BY_KIND,
  type ItemDecision,
  LATENESS_FRACTIONS,
  type LatenessTier,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import { ArrowRightIcon, GavelIcon } from 'lucide-react';
import { type ComponentProps, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';
import { formatCalendarDate, formatDateTime, formatNumber } from '../../lib/format';
import { imageSrc } from '../../lib/images';
import { ChoiceSelect } from '../quotes/choice-select';
import { FormDialog } from '../quotes/quote-dialogs';
import { DayDetail, fractionText, itemSummary } from './attendance-month';
import { ItemStatusBadge } from './attendance-parts';
import { attendanceItemQuery, useDecideItem } from './hr.queries';
import { Detail, Opinions } from './hr-request-page';

const isMissing = (error: unknown) => error instanceof ApiError && error.status === 404;

/**
 * An attendance item (spec screen "Approvals"): the day's timeline, the justification and the
 * opinions; `hr.approve` decides it (rule C18) and may change a decision while the month is open.
 */
export function HrItemPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const item = useQuery(attendanceItemQuery(id));
  return (
    <>
      <div>
        <Button
          variant="ghost"
          size="sm"
          render={<Link to="/hr/approvals" search={{ view: 'items' }} />}
        >
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('hr.items.back')}
        </Button>
      </div>
      {item.isPending ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-28" />
          <Skeleton className="h-56" />
        </div>
      ) : item.isError ? (
        <LoadError
          message={isMissing(item.error) ? t('hr.items.notFound') : t('hr.items.loadError')}
          onRetry={() => item.refetch()}
          error={item.error}
        />
      ) : (
        <Item item={item.data} />
      )}
    </>
  );
}

function Item({ item }: { item: AttendanceItemDetail }) {
  const { t } = useTranslation();
  const [deciding, setDeciding] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const { canDecide, canGiveOpinion } = item.permissions;

  return (
    <>
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 sm:flex-row sm:items-center">
        <Avatar name={item.user.name} src={imageSrc(item.user.imageId, 'lg')} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm text-muted-foreground">{item.user.name}</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">{itemSummary(t, item)}</h1>
            <ItemStatusBadge status={item.status} />
          </div>
          <p className="text-muted-foreground">{formatCalendarDate(item.date)}</p>
        </div>
        {canDecide && (
          <Button ref={button} onClick={() => setDeciding(true)}>
            <GavelIcon />
            {item.status === 'pending' ? t('hr.items.decide') : t('hr.items.changeDecision')}
          </Button>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('hr.items.details')}</CardTitle>
          </CardHeader>
          <dl className="flex flex-col gap-3 text-sm">
            <Detail label={t('hr.items.proposal')}>{proposalText(t, item)}</Detail>
            <Detail label={t('hr.items.justification')}>
              {item.justification ?? (
                <span className="text-muted-foreground">{t('hr.items.noJustification')}</span>
              )}
            </Detail>
            {item.decidedBy && item.decidedAt && (
              <Detail label={t('hr.items.decidedBy')}>
                {`${item.decidedBy.name} · ${formatDateTime(item.decidedAt)}`}
              </Detail>
            )}
            {item.status !== 'pending' && item.status !== 'void' && (
              <Detail label={t('hr.items.decision')}>{decisionText(t, item)}</Detail>
            )}
            {item.decisionNote && (
              <Detail label={t('hr.items.decisionNote')}>{item.decisionNote}</Detail>
            )}
          </dl>
        </Card>
        <Opinions
          target={{ itemId: item.id }}
          opinions={item.opinions}
          canGiveOpinion={canGiveOpinion}
        />
      </div>

      <Card className="px-0 pb-0">
        <CardHeader className="px-6">
          <CardTitle className="text-lg">{t('hr.items.day')}</CardTitle>
        </CardHeader>
        <DayDetail day={item.day} />
      </Card>

      <DecideItemDialog
        item={deciding ? item : null}
        onClose={() => setDeciding(false)}
        finalFocus={() => button.current ?? true}
      />
    </>
  );
}

/** What rule C17 proposes: a share of a day, a warning, or nothing to deduct. */
export function proposalText(t: TFunction, item: AttendanceItem): string {
  if (item.kind === 'overtime') return t('hr.items.proposals.overtime');
  if (item.proposedFraction === 0) {
    return item.kind === 'missing_out'
      ? t('hr.items.proposals.none')
      : t('hr.items.proposals.warning');
  }
  return fractionText(t, item.proposedFraction);
}

function decisionText(t: TFunction, item: AttendanceItem): string {
  const label = t(`hr.items.statuses.${item.status}`);
  if (item.decidedFraction !== null) return `${label} · ${fractionText(t, item.decidedFraction)}`;
  if (item.creditedDays !== null) {
    return `${label} · ${t('hr.items.credited', { days: formatNumber(item.creditedDays) })}`;
  }
  return label;
}

type FinalFocus = ComponentProps<typeof FormDialog>['finalFocus'];

/** The fraction's value in the select: a key cannot hold the decimal point. */
const fractionValue = (fraction: number) => String(fraction);

/**
 * Rule C18: the decisions an item's kind takes; a deduction's fraction (the proposal by default),
 * the minutes paid or taken as time off (all of them by default), and a note.
 */
export function DecideItemDialog({
  item,
  onClose,
  finalFocus,
}: {
  item: AttendanceItem | null;
  onClose: () => void;
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const decide = useDecideItem();
  const ids = { decision: useId() };
  const [decision, setDecision] = useState<ItemDecision | null>(null);
  const [fraction, setFraction] = useState<string | null>(null);
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
  const [invalidMinutes, setInvalidMinutes] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const choices = item ? ITEM_DECISIONS_BY_KIND[item.kind] : [];
  const current = decision ?? choices[0] ?? 'waived';
  const timed = current === 'paid' || current === 'time_off';
  const proposed =
    item && item.proposedFraction > 0 ? fractionValue(item.proposedFraction) : '0.25';

  return (
    <FormDialog
      open={item !== null}
      onClose={onClose}
      onClosed={() => {
        setDecision(null);
        setFraction(null);
        setMinutes('');
        setNote('');
        setInvalidMinutes(false);
        setFailure(null);
      }}
      finalFocus={finalFocus}
      submitting={decide.isPending}
      title={t('hr.items.decideTitle')}
      description={
        item ? `${item.user.name} · ${itemSummary(t, item)} · ${formatCalendarDate(item.date)}` : ''
      }
      action={t('hr.items.saveDecision')}
      failure={failure}
      onSubmit={async (event) => {
        event?.preventDefault();
        if (!item) return;
        setFailure(null);
        const typed = minutes.trim() ? Number(minutes) : undefined;
        if (
          timed &&
          typed !== undefined &&
          !(Number.isInteger(typed) && typed >= 1 && typed <= item.minutes)
        ) {
          setInvalidMinutes(true);
          return;
        }
        try {
          await decide.mutateAsync({
            id: item.id,
            decision: current,
            fraction:
              current === 'deducted'
                ? (Number(fraction ?? proposed) as LatenessTier['fraction'])
                : undefined,
            minutes: timed ? typed : undefined,
            note: note.trim() || null,
          });
          toast.add({ title: t('hr.items.decided'), type: 'success' });
          onClose();
        } catch (error) {
          setFailure(errorMessage(t, error));
        }
      }}
    >
      <Field>
        <FieldLabel id={ids.decision} render={<span />}>
          {t('hr.items.decision')}
        </FieldLabel>
        <ToggleGroup
          aria-labelledby={ids.decision}
          value={[current]}
          onValueChange={(next: ItemDecision[]) => next[0] && setDecision(next[0])}
          className="flex-wrap"
        >
          {choices.map((choice) => (
            <ToggleGroupItem key={choice} value={choice}>
              {t(`hr.items.decisions.${choice}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {item && (
          <FieldDescription>
            {t('hr.items.proposalIs', { proposal: proposalText(t, item) })}
          </FieldDescription>
        )}
      </Field>
      {current === 'deducted' && (
        <Field>
          <FieldLabel>{t('hr.items.fraction')}</FieldLabel>
          <ChoiceSelect
            label={t('hr.items.fraction')}
            items={LATENESS_FRACTIONS.map((value) => ({
              value: fractionValue(value),
              label: fractionText(t, value),
            }))}
            value={fraction ?? proposed}
            onChange={setFraction}
          />
        </Field>
      )}
      {timed && item && (
        <Field invalid={invalidMinutes}>
          <FieldLabel>{t('hr.items.minutes')}</FieldLabel>
          <Input
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            placeholder={String(item.minutes)}
            value={minutes}
            onChange={(event) => {
              setMinutes(event.target.value);
              setInvalidMinutes(false);
            }}
          />
          <FieldDescription>
            {current === 'time_off' ? t('hr.items.timeOffHint') : t('hr.items.paidHint')}
          </FieldDescription>
          <FieldError match={invalidMinutes}>
            {t('hr.items.minutesInvalid', { max: formatNumber(item.minutes) })}
          </FieldError>
        </Field>
      )}
      <Field>
        <FieldLabel>{t('hr.items.noteOptional')}</FieldLabel>
        <Textarea
          rows={2}
          maxLength={ATTENDANCE_ITEM_LIMITS.note}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
    </FormDialog>
  );
}
