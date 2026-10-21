import { useQuery } from '@tanstack/react-query';
import {
  daysInclusive,
  HOLIDAY_LIMITS,
  type Holiday,
  holidayRangeValid,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  CalendarOffIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  PencilIcon,
  PlusIcon,
} from 'lucide-react';
import { type ComponentProps, useId, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
import { ApiError } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatNumber } from '../../lib/format';
import { FormDialog } from '../quotes/quote-dialogs';
import {
  holidaysQuery,
  useArchiveHoliday,
  useCreateHoliday,
  useRepeatHolidays,
  useUpdateHoliday,
} from './hr.queries';

/**
 * Rule B3: the public holidays of a year, typed each year (the Eids move); "Repeat last year"
 * copies the previous year's to the same dates for review.
 */
export function HolidaysTab({
  year,
  onYearChange,
}: {
  year: number;
  onYearChange: (year: number) => void;
}) {
  const { t } = useTranslation();
  const holidays = useQuery(holidaysQuery(year));
  const [editing, setEditing] = useState<Holiday | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Holiday | null>(null);
  const [repeating, setRepeating] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const repeatButton = useRef<HTMLButtonElement>(null);
  const archive = useArchiveHoliday();
  const repeat = useRepeatHolidays();

  return (
    <div className="flex flex-col gap-4">
      <TabHeader
        title={t('hr.holidays.title')}
        description={t('hr.holidays.hint')}
        action={
          <div className="flex flex-wrap gap-2">
            <Button ref={repeatButton} variant="outline" onClick={() => setRepeating(true)}>
              <CopyIcon />
              {t('hr.holidays.repeat')}
            </Button>
            <Button ref={addButton} onClick={() => setEditing('new')}>
              <PlusIcon />
              {t('hr.holidays.add')}
            </Button>
          </div>
        }
      />
      <YearPicker year={year} onChange={onYearChange} />
      {holidays.isPending ? (
        <Skeleton className="h-48" />
      ) : holidays.isError ? (
        <LoadError message={t('hr.holidays.loadError')} onRetry={() => holidays.refetch()} />
      ) : holidays.data.items.length === 0 ? (
        <EmptyState
          icon={<CalendarOffIcon />}
          title={t('hr.holidays.emptyTitle', { year: String(year) })}
          description={t('hr.holidays.emptyHint')}
        />
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hr.holidays.name')}</TableHead>
                <TableHead>{t('hr.holidays.dates')}</TableHead>
                <TableHead>{t('hr.holidays.length')}</TableHead>
                <TableHead>{t('hr.holidays.pay')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('hr.holidays.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holidays.data.items.map((holiday) => (
                <TableRow key={holiday.id} data-holiday={holiday.name}>
                  <TableCell className="font-medium">{holiday.name}</TableCell>
                  <TableCell className="tabular-nums">
                    <HolidayDates holiday={holiday} />
                  </TableCell>
                  <TableCell>
                    {t('hr.file.days', {
                      count: daysInclusive(holiday.startsOn, holiday.endsOn),
                      days: formatNumber(daysInclusive(holiday.startsOn, holiday.endsOn)),
                    })}
                  </TableCell>
                  <TableCell>
                    <Badge tone={holiday.paid ? 'success' : 'neutral'}>
                      {holiday.paid ? t('hr.holidays.paid') : t('hr.holidays.unpaid')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <IconButton
                        label={t('hr.holidays.editOf', { name: holiday.name })}
                        onClick={() => setEditing(holiday)}
                      >
                        <PencilIcon />
                      </IconButton>
                      <IconButton
                        label={t('hr.holidays.archiveOf', { name: holiday.name })}
                        onClick={() => setArchiving(holiday)}
                      >
                        <ArchiveIcon />
                      </IconButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <HolidayDialog
        holiday={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        finalFocus={() => addButton.current ?? true}
      />
      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={t('hr.holidays.archiveTitle', { name: archiving?.name ?? '' })}
        body={t('hr.holidays.archiveBody')}
        action={t('hr.holidays.archive')}
        destructive
        pending={archive.isPending}
        onConfirm={async () => {
          if (!archiving) return;
          await archive.mutateAsync(archiving.id);
          toast.add({ title: t('hr.holidays.archived'), type: 'success' });
        }}
        finalFocus={() => addButton.current ?? true}
      />
      <ConfirmDialog
        open={repeating}
        onClose={() => setRepeating(false)}
        title={t('hr.holidays.repeatTitle', { from: String(year - 1), to: String(year) })}
        body={t('hr.holidays.repeatBody')}
        action={t('hr.holidays.repeat')}
        pending={repeat.isPending}
        onConfirm={async () => {
          const copies = await repeat.mutateAsync(year);
          toast.add({
            title:
              copies.items.length === 0
                ? t('hr.holidays.repeatedNone')
                : t('hr.holidays.repeated', {
                    count: copies.items.length,
                    holidays: formatNumber(copies.items.length),
                  }),
            type: copies.items.length === 0 ? 'info' : 'success',
          });
        }}
        finalFocus={() => repeatButton.current ?? true}
      />
    </div>
  );
}

function HolidayDates({ holiday }: { holiday: Holiday }) {
  const { t } = useTranslation();
  return holiday.startsOn === holiday.endsOn
    ? formatDate(holiday.startsOn)
    : t('hr.holidays.range', {
        from: formatDate(holiday.startsOn),
        to: formatDate(holiday.endsOn),
      });
}

/** The year shown; the previous year sits at the inline start, as on the calendar. */
function YearPicker({ year, onChange }: { year: number; onChange: (year: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <IconButton label={t('hr.holidays.previousYear')} onClick={() => onChange(year - 1)}>
        <ChevronRightIcon className="ltr:-scale-x-100" />
      </IconButton>
      <h3 className="min-w-16 text-center text-lg font-bold tabular-nums" aria-live="polite">
        {year}
      </h3>
      <IconButton label={t('hr.holidays.nextYear')} onClick={() => onChange(year + 1)}>
        <ChevronLeftIcon className="ltr:-scale-x-100" />
      </IconButton>
    </div>
  );
}

interface HolidayValues {
  name: string;
  startsOn: string;
  endsOn: string;
  paid: boolean;
}

/** Rule B3: at most ten days, never overlapping another holiday. */
function HolidayDialog({
  holiday,
  open,
  onClose,
  finalFocus,
}: {
  holiday: Holiday | null;
  open: boolean;
  onClose: () => void;
  finalFocus: ComponentProps<typeof FormDialog>['finalFocus'];
}) {
  const { t } = useTranslation();
  const ids = { paid: useId() };
  const create = useCreateHoliday();
  const update = useUpdateHoliday();
  const defaults: HolidayValues = {
    name: holiday?.name ?? '',
    startsOn: holiday?.startsOn ?? '',
    endsOn: holiday?.endsOn ?? '',
    paid: holiday?.paid ?? true,
  };
  const form = useForm<HolidayValues>({ values: defaults });
  const [failure, setFailure] = useState<string | null>(null);
  const { errors, isDirty } = form.formState;
  const startsOn = useWatch({ control: form.control, name: 'startsOn' });

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (holiday && !isDirty) return onClose();
    // A one-day holiday needs only its start.
    const range = { startsOn: values.startsOn, endsOn: values.endsOn || values.startsOn };
    if (!holidayRangeValid(range)) {
      return form.setError('endsOn', { type: 'range' }, { shouldFocus: true });
    }
    const input = { name: values.name.trim(), ...range, paid: values.paid };
    try {
      if (holiday) await update.mutateAsync({ id: holiday.id, ...input });
      else await create.mutateAsync(input);
      toast.add({
        title: holiday ? t('hr.holidays.saved') : t('hr.holidays.added'),
        type: 'success',
      });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'HOLIDAY_OVERLAP') {
        form.setError('startsOn', { type: 'overlap' }, { shouldFocus: true });
      } else if (error instanceof ApiError && error.code === 'INVALID_DATES') {
        form.setError('endsOn', { type: 'range' }, { shouldFocus: true });
      } else {
        setFailure(errorMessage(t, error));
      }
    }
  });

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onClosed={() => {
        setFailure(null);
        form.reset(defaults);
      }}
      finalFocus={finalFocus}
      submitting={form.formState.isSubmitting}
      title={holiday ? t('hr.holidays.editTitle') : t('hr.holidays.addTitle')}
      description={t('hr.holidays.dialogHint')}
      action={holiday ? t('common.save') : t('hr.holidays.add')}
      failure={failure}
      onSubmit={submit}
    >
      <Field invalid={!!errors.name}>
        <FieldLabel>{t('hr.holidays.name')}</FieldLabel>
        <Input
          autoComplete="off"
          placeholder={t('hr.holidays.namePlaceholder')}
          {...form.register('name', {
            validate: (name) => name.trim().length > 0 && name.trim().length <= HOLIDAY_LIMITS.name,
          })}
        />
        <FieldError match={!!errors.name}>{t('hr.holidays.errors.name')}</FieldError>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field invalid={!!errors.startsOn}>
          <FieldLabel>{t('hr.holidays.startsOn')}</FieldLabel>
          <Input
            type="date"
            dir="ltr"
            {...form.register('startsOn', { validate: (day) => day.length > 0 })}
          />
          <FieldError
            match={!!errors.startsOn}
            role={errors.startsOn?.type === 'overlap' ? 'alert' : undefined}
          >
            {errors.startsOn?.type === 'overlap'
              ? t('errors.HOLIDAY_OVERLAP')
              : t('hr.holidays.errors.startsOn')}
          </FieldError>
        </Field>
        <Field invalid={!!errors.endsOn}>
          <FieldLabel>{t('hr.holidays.endsOn')}</FieldLabel>
          <Input type="date" dir="ltr" min={startsOn || undefined} {...form.register('endsOn')} />
          <FieldDescription>{t('hr.holidays.endsOnHint')}</FieldDescription>
          <FieldError match={!!errors.endsOn} role="alert">
            {t('hr.holidays.errors.range', { days: formatNumber(HOLIDAY_LIMITS.days) })}
          </FieldError>
        </Field>
      </div>
      <Controller
        control={form.control}
        name="paid"
        render={({ field }) => (
          <Field>
            <div className="flex items-center justify-between gap-4">
              <FieldLabel htmlFor={ids.paid}>{t('hr.holidays.paid')}</FieldLabel>
              <Switch id={ids.paid} checked={field.value} onCheckedChange={field.onChange} />
            </div>
            <FieldDescription>{t('hr.holidays.paidHint')}</FieldDescription>
          </Field>
        )}
      />
    </FormDialog>
  );
}
