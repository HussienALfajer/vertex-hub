import { useQuery } from '@tanstack/react-query';
import {
  createWorkScheduleSchema,
  minutesOfDay,
  scheduleTimesValid,
  updateWorkScheduleSchema,
  WEEKDAYS,
  type Weekday,
  WORK_SCHEDULE_KINDS,
  WORK_SCHEDULE_LIMITS,
  type WorkSchedule,
  type WorkScheduleDay,
  type WorkScheduleKind,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import { ArchiveIcon, ClockIcon, PencilIcon, PlusIcon, StarIcon } from 'lucide-react';
import { type ComponentProps, useId, useRef, useState } from 'react';
import { Controller, type UseFormReturn, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
import { ApiError } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';
import { formatNumber, isolateLtr } from '../../lib/format';
import { rateInput } from '../../lib/money';
import { FormDialog } from '../quotes/quote-dialogs';
import {
  useArchiveWorkSchedule,
  useCreateWorkSchedule,
  useUpdateWorkSchedule,
  workSchedulesQuery,
} from './hr.queries';

/** A time of day `minutes` after midnight, as `HH:MM`. */
const timeOf = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Required minutes as `H:MM`, the way the day's length is read. */
const durationOf = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

/** Rule B2: the work schedules, the default first; each with its days and assigned employees. */
export function SchedulesTab() {
  const { t } = useTranslation();
  const schedules = useQuery(workSchedulesQuery);
  const [editing, setEditing] = useState<WorkSchedule | 'new' | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex flex-col gap-4">
      <TabHeader
        title={t('hr.schedules.title')}
        description={t('hr.schedules.hint')}
        action={
          <Button ref={addButton} onClick={() => setEditing('new')}>
            <PlusIcon />
            {t('hr.schedules.add')}
          </Button>
        }
      />
      {schedules.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : schedules.isError ? (
        <LoadError message={t('hr.schedules.loadError')} onRetry={() => schedules.refetch()} />
      ) : schedules.data.items.length === 0 ? (
        <EmptyState
          icon={<ClockIcon />}
          title={t('hr.schedules.emptyTitle')}
          description={t('hr.schedules.emptyHint')}
        />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {schedules.data.items.map((schedule) => (
            <li key={schedule.id}>
              <ScheduleCard schedule={schedule} onEdit={() => setEditing(schedule)} />
            </li>
          ))}
        </ul>
      )}
      <ScheduleDialog
        schedule={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        finalFocus={() => addButton.current ?? true}
      />
    </div>
  );
}

function ScheduleCard({ schedule, onEdit }: { schedule: WorkSchedule; onEdit: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateWorkSchedule();
  const archive = useArchiveWorkSchedule();
  const [archiving, setArchiving] = useState(false);
  const archiveButton = useRef<HTMLButtonElement>(null);
  const days = new Map(schedule.days.map((day) => [day.weekday, day]));

  const makeDefault = async () => {
    try {
      await update.mutateAsync({ id: schedule.id, isDefault: true });
      toast.add({ title: t('hr.schedules.madeDefault', { name: schedule.name }), type: 'success' });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  };

  return (
    <Card data-schedule={schedule.name}>
      <CardHeader className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="me-auto">{schedule.name}</CardTitle>
          {schedule.isDefault && (
            <Badge tone="brand">
              <StarIcon />
              {t('hr.schedules.default')}
            </Badge>
          )}
          <Badge tone="outline">{t(`hr.scheduleKinds.${schedule.kind}`)}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('hr.schedules.employees', {
            count: schedule.employees,
            employees: formatNumber(schedule.employees),
          })}
        </p>
      </CardHeader>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 px-6 text-sm">
        {WEEKDAYS.map((weekday) => {
          const day = days.get(weekday);
          return (
            <div key={weekday} className="contents">
              <dt className="text-muted-foreground">{t(`hr.weekdays.${weekday}`)}</dt>
              <dd className="tabular-nums">
                {day ? <DayText kind={schedule.kind} day={day} /> : t('hr.schedules.offDay')}
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="flex flex-wrap gap-2 p-6">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <PencilIcon />
          {t('common.edit')}
        </Button>
        {!schedule.isDefault && (
          <>
            <Button variant="outline" size="sm" disabled={update.isPending} onClick={makeDefault}>
              <StarIcon />
              {t('hr.schedules.makeDefault')}
            </Button>
            <Button
              ref={archiveButton}
              variant="ghost"
              size="sm"
              onClick={() => setArchiving(true)}
            >
              <ArchiveIcon />
              {t('hr.schedules.archive')}
            </Button>
          </>
        )}
      </div>
      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        title={t('hr.schedules.archiveTitle', { name: schedule.name })}
        body={t('hr.schedules.archiveBody')}
        action={t('hr.schedules.archive')}
        destructive
        pending={archive.isPending}
        onConfirm={async () => {
          await archive.mutateAsync(schedule.id);
          toast.add({ title: t('hr.schedules.archived'), type: 'success' });
        }}
        finalFocus={() => archiveButton.current ?? true}
      />
    </Card>
  );
}

/** A fixed day as its hours; a flexible day as its start window and its length. */
function DayText({ kind, day }: { kind: WorkScheduleKind; day: WorkScheduleDay }) {
  const { t } = useTranslation();
  const start = minutesOfDay(day.startTime);
  if (kind === 'fixed') {
    return isolateLtr(`${day.startTime} – ${timeOf(start + day.requiredMinutes)}`);
  }
  return t('hr.schedules.flexibleDay', {
    from: isolateLtr(day.startTime),
    to: isolateLtr(day.latestStartTime ?? day.startTime),
    duration: isolateLtr(durationOf(day.requiredMinutes)),
  });
}

interface DayValues {
  on: boolean;
  startTime: string;
  latestStartTime: string;
  /** Hours as typed: `8`, `7.5`. */
  hours: string;
}

interface ScheduleValues {
  name: string;
  kind: WorkScheduleKind;
  isDefault: boolean;
  days: Record<Weekday, DayValues>;
}

/** The seeded "Main schedule": Saturday to Thursday, 09:00 for 8 hours. */
const NEW_DAY: DayValues = { on: true, startTime: '09:00', latestStartTime: '10:00', hours: '8' };

function valuesOf(schedule: WorkSchedule | null): ScheduleValues {
  const days = new Map(schedule?.days.map((day) => [day.weekday, day]));
  return {
    name: schedule?.name ?? '',
    kind: schedule?.kind ?? 'fixed',
    isDefault: false,
    days: Object.fromEntries(
      WEEKDAYS.map((weekday) => {
        const day = days.get(weekday);
        if (!schedule) return [weekday, { ...NEW_DAY, on: weekday !== 'friday' }];
        return [
          weekday,
          day
            ? {
                on: true,
                startTime: day.startTime,
                latestStartTime: day.latestStartTime ?? NEW_DAY.latestStartTime,
                hours: String(day.requiredMinutes / 60),
              }
            : { ...NEW_DAY, on: false },
        ];
      }),
    ) as Record<Weekday, DayValues>,
  };
}

/** Rule B2: a schedule's name, kind and days; its days are replaced as a whole on an edit. */
function ScheduleDialog({
  schedule,
  open,
  onClose,
  finalFocus,
}: {
  schedule: WorkSchedule | null;
  open: boolean;
  onClose: () => void;
  finalFocus: ComponentProps<typeof FormDialog>['finalFocus'];
}) {
  const { t } = useTranslation();
  const ids = { kind: useId(), isDefault: useId(), days: useId() };
  const create = useCreateWorkSchedule();
  const update = useUpdateWorkSchedule();
  const defaults = valuesOf(schedule);
  const form = useForm<ScheduleValues>({ values: defaults });
  const [failure, setFailure] = useState<string | null>(null);
  const [daysError, setDaysError] = useState<string | null>(null);
  const { errors, isDirty } = form.formState;
  const kind = useWatch({ control: form.control, name: 'kind' });

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    setDaysError(null);
    if (schedule && !isDirty) return onClose();
    const days = WEEKDAYS.filter((weekday) => values.days[weekday].on).map((weekday) => {
      const day = values.days[weekday];
      return {
        weekday,
        startTime: day.startTime,
        latestStartTime: values.kind === 'flexible' ? day.latestStartTime : null,
        requiredMinutes: Math.round(Number(rateInput(day.hours) || Number.NaN) * 60),
      };
    });
    if (days.length === 0) return setDaysError(t('hr.schedules.errors.noDays'));
    const fields = { name: values.name, kind: values.kind, days };
    // The name is checked by its field; what the schema still refuses is in the days.
    const valid = schedule
      ? updateWorkScheduleSchema.safeParse(fields).success
      : createWorkScheduleSchema.safeParse(fields).success;
    if (!valid) return setDaysError(t('hr.schedules.errors.days'));
    if (!scheduleTimesValid(values.kind, days)) return setDaysError(t('errors.INVALID_TIMES'));
    try {
      if (schedule) await update.mutateAsync({ id: schedule.id, ...fields });
      else await create.mutateAsync({ ...fields, isDefault: values.isDefault });
      toast.add({
        title: schedule ? t('hr.schedules.saved') : t('hr.schedules.added'),
        type: 'success',
      });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SCHEDULE_NAME_TAKEN') {
        form.setError('name', { type: 'server' }, { shouldFocus: true });
      } else if (error instanceof ApiError && error.code === 'INVALID_TIMES') {
        setDaysError(t('errors.INVALID_TIMES'));
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
        setDaysError(null);
        form.reset(defaults);
      }}
      finalFocus={finalFocus}
      submitting={form.formState.isSubmitting}
      title={schedule ? t('hr.schedules.editTitle') : t('hr.schedules.addTitle')}
      description={t('hr.schedules.dialogHint')}
      action={schedule ? t('common.save') : t('hr.schedules.add')}
      failure={failure}
      onSubmit={submit}
    >
      <Field invalid={!!errors.name}>
        <FieldLabel>{t('hr.schedules.name')}</FieldLabel>
        <Input
          autoComplete="off"
          {...form.register('name', {
            validate: (name) =>
              name.trim().length > 0 && name.trim().length <= WORK_SCHEDULE_LIMITS.name,
          })}
        />
        <FieldError
          match={!!errors.name}
          role={errors.name?.type === 'server' ? 'alert' : undefined}
        >
          {errors.name?.type === 'server'
            ? t('errors.SCHEDULE_NAME_TAKEN')
            : t('hr.schedules.errors.name')}
        </FieldError>
      </Field>
      <Controller
        control={form.control}
        name="kind"
        render={({ field }) => (
          <Field>
            <FieldLabel id={ids.kind} render={<span />}>
              {t('hr.schedules.kind')}
            </FieldLabel>
            <ToggleGroup
              aria-labelledby={ids.kind}
              value={[field.value]}
              onValueChange={(next: WorkScheduleKind[]) => next[0] && field.onChange(next[0])}
            >
              {WORK_SCHEDULE_KINDS.map((option) => (
                <ToggleGroupItem key={option} value={option}>
                  {t(`hr.scheduleKinds.${option}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>{t(`hr.schedules.kindHints.${field.value}`)}</FieldDescription>
          </Field>
        )}
      />
      <fieldset className="flex flex-col gap-3" aria-describedby={ids.days}>
        <legend className="mb-2 font-medium">{t('hr.schedules.days')}</legend>
        <div className="flex flex-col divide-y divide-border rounded-md border border-border">
          {WEEKDAYS.map((weekday) => (
            <DayRow key={weekday} weekday={weekday} kind={kind} form={form} />
          ))}
        </div>
        {daysError && (
          <p id={ids.days} role="alert" className="text-sm text-destructive-text">
            {daysError}
          </p>
        )}
      </fieldset>
      {!schedule && (
        <Controller
          control={form.control}
          name="isDefault"
          render={({ field }) => (
            <Field>
              <div className="flex items-center justify-between gap-4">
                <FieldLabel htmlFor={ids.isDefault}>{t('hr.schedules.makeDefault')}</FieldLabel>
                <Switch id={ids.isDefault} checked={field.value} onCheckedChange={field.onChange} />
              </div>
              <FieldDescription>{t('hr.schedules.defaultHint')}</FieldDescription>
            </Field>
          )}
        />
      )}
    </FormDialog>
  );
}

function DayRow({
  weekday,
  kind,
  form,
}: {
  weekday: Weekday;
  kind: WorkScheduleKind;
  form: UseFormReturn<ScheduleValues>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const on = useWatch({ control: form.control, name: `days.${weekday}.on` });
  const day = t(`hr.weekdays.${weekday}`);
  return (
    <div className="flex flex-wrap items-center gap-3 p-3" data-weekday={weekday}>
      <Controller
        control={form.control}
        name={`days.${weekday}.on`}
        render={({ field }) => (
          <div className="flex w-28 items-center gap-2">
            <Checkbox id={id} checked={field.value} onCheckedChange={field.onChange} />
            <label htmlFor={id} className="text-sm font-medium">
              {day}
            </label>
          </div>
        )}
      />
      {on ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="time"
            dir="ltr"
            className="w-36"
            aria-label={t(kind === 'fixed' ? 'hr.schedules.startOf' : 'hr.schedules.earliestOf', {
              day,
            })}
            {...form.register(`days.${weekday}.startTime`)}
          />
          {kind === 'flexible' && (
            <Input
              type="time"
              dir="ltr"
              className="w-36"
              aria-label={t('hr.schedules.latestOf', { day })}
              {...form.register(`days.${weekday}.latestStartTime`)}
            />
          )}
          <Input
            dir="ltr"
            inputMode="decimal"
            autoComplete="off"
            className="w-20"
            aria-label={t('hr.schedules.hoursOf', { day })}
            {...form.register(`days.${weekday}.hours`)}
          />
          <span className="text-sm text-muted-foreground">{t('hr.schedules.hoursUnit')}</span>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">{t('hr.schedules.offDay')}</span>
      )}
    </div>
  );
}
