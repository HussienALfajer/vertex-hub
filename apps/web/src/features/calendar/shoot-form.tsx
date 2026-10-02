import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  addDays,
  businessInstant,
  businessTimeOfDay,
  CALENDAR_LIMITS,
  CREW_ROLES,
  type CrewRole,
  calendarDay,
  createShootSchema,
  type ScheduleConflict,
  SHOOT_DEPARTMENT,
  SHOOT_TYPES,
  type ShootDetail,
  type ShootType,
  shotListInputSchema,
  type TaskDetail,
  updateShootSchema,
} from '@vertex-hub/contracts';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Avatar,
  Button,
  Callout,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PlusIcon,
  StarIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { Controller, type UseFormReturn, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { ApiError } from '../../lib/api/client';
import { useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatMonth } from '../../lib/format';
import { projectListQuery, projectQuery } from '../projects/projects.queries';
import { lineName } from '../retainers/retainer-badges';
import { retainerListQuery } from '../retainers/retainers.queries';
import { useClientOptions } from '../tasks/task-form';
import { taskListQuery } from '../tasks/tasks.queries';
import { userListQuery } from '../users/users.queries';
import { conflictsQuery, useCreateShoot, useSaveShots, useUpdateShoot } from './calendar.queries';
import { ConflictList, canBookShootsOf, SHOOT_TYPE_ICONS } from './calendar-parts';

/*
 * Booking and editing a shoot (spec F11, screen 2). The date and times are entered apart and
 * sent as one start and one end; everything is checked by the contract schema before it is sent.
 */

/** The client select's value for an internal shoot. */
const INTERNAL = 'internal';

/** The task select's value for a shoot task created with the booking (rule 3). */
const NEW_TASK = 'new';

const NONE = 'none';

interface ShootFormValues {
  title: string;
  type: ShootType | null;
  /** A client id, `INTERNAL`, or blank until one is picked. */
  client: string;
  /** A bookable task's id, or `NEW_TASK`. */
  task: string;
  projectId: string | null;
  milestoneId: string | null;
  retainerCycleId: string | null;
  cycleLineId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  mapUrl: string;
  brief: string;
  crew: { userId: string; role: CrewRole; isLead: boolean }[];
  externalCrew: { name: string; role: CrewRole; phone: string }[];
  shots: { id?: string; text: string; note: string }[];
}

type FormMethods = UseFormReturn<ShootFormValues>;

/** The parts of the form a refusal or a failed check is shown under. */
type Problem =
  | 'title'
  | 'type'
  | 'client'
  | 'task'
  | 'links'
  | 'time'
  | 'location'
  | 'mapUrl'
  | 'brief'
  | 'crew'
  | 'externalCrew'
  | 'shots';

type Problems = Partial<Record<Problem, string>>;

/** The part of the form a field of the contract belongs to. */
const PROBLEM_OF_FIELD: Record<string, Problem> = {
  title: 'title',
  type: 'type',
  clientId: 'client',
  taskId: 'task',
  newTask: 'links',
  startsAt: 'time',
  endsAt: 'time',
  location: 'location',
  mapUrl: 'mapUrl',
  brief: 'brief',
  crew: 'crew',
  externalCrew: 'externalCrew',
  shots: 'shots',
};

/** The part of the form a refusal concerns; anything else shows above the buttons. */
const PROBLEM_OF_CODE: Record<string, Problem> = {
  TASK_NOT_BOOKABLE: 'task',
  LEAD_REQUIRED: 'crew',
  INVALID_CREW: 'crew',
  CLIENT_ARCHIVED: 'client',
  CLIENT_ENDED: 'client',
  NO_ENGAGEMENT: 'links',
  INVALID_LINK: 'links',
  PROJECT_CLOSED: 'links',
  PROJECT_ARCHIVED: 'links',
  RETAINER_ARCHIVED: 'links',
  CYCLE_CLOSED: 'links',
  MILESTONE_DONE: 'links',
};

/**
 * The start and end as instants. An end time at or before the start time ends the shoot on the
 * next day (edge case 3). Null until the date and both times are entered.
 */
function instantsOf(values: Pick<ShootFormValues, 'date' | 'startTime' | 'endTime'>) {
  const { date, startTime, endTime } = values;
  if (!date || !startTime || !endTime) return null;
  const endDay = endTime <= startTime ? addDays(date, 1) : date;
  return {
    startsAt: businessInstant(date, startTime).toISOString(),
    endsAt: businessInstant(endDay, endTime).toISOString(),
  };
}

const timeInput = (instant: string) => businessTimeOfDay(new Date(instant)).slice(0, 5);

function defaultsOf(shoot: ShootDetail | undefined, task: TaskDetail | undefined, all: boolean) {
  const values: ShootFormValues = {
    title: shoot?.title ?? task?.title ?? '',
    type: shoot?.type ?? null,
    // Only scope all books an internal shoot; an account manager picks one of their clients.
    client: (shoot ?? task) ? ((shoot ?? task)?.client?.id ?? INTERNAL) : all ? INTERNAL : '',
    task: shoot?.task.id ?? task?.id ?? NEW_TASK,
    projectId: null,
    milestoneId: null,
    retainerCycleId: null,
    cycleLineId: null,
    date: shoot ? calendarDay(shoot.startsAt) : '',
    startTime: shoot ? timeInput(shoot.startsAt) : '',
    endTime: shoot ? timeInput(shoot.endsAt) : '',
    location: shoot?.location ?? '',
    mapUrl: shoot?.mapUrl ?? '',
    brief: shoot?.brief ?? '',
    crew: shoot?.crew.map(({ user, role, isLead }) => ({ userId: user.id, role, isLead })) ?? [
      { userId: '', role: 'photographer', isLead: true },
    ],
    externalCrew:
      shoot?.externalCrew.map((member) => ({ ...member, phone: member.phone ?? '' })) ?? [],
    shots: shoot?.shots.map(({ id, text, note }) => ({ id, text, note: note ?? '' })) ?? [],
  };
  return values;
}

/**
 * The booking form: a new shoot (from `task`, or with the task picked here) or the edit of a
 * scheduled one, whose client and task never change (rule 8).
 */
export function ShootForm({ shoot, task }: { shoot?: ShootDetail; task?: TaskDetail }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const create = useCreateShoot();
  const update = useUpdateShoot(shoot?.id ?? '');
  const saveShots = useSaveShots(shoot?.id ?? '');
  const scopeAll = canBookShootsOf(me, null);
  const form = useForm<ShootFormValues>({ defaultValues: defaultsOf(shoot, task, scopeAll) });
  const [problems, setProblems] = useState<Problems>({});
  const [failure, setFailure] = useState<string | null>(null);
  /** The conflicts to accept before the save goes through (rule 5). */
  const [confirming, setConfirming] = useState<ScheduleConflict[] | null>(null);
  const fixed = !!shoot || !!task;
  const back = shoot
    ? ({ to: '/shoots/$shootId', params: { shootId: shoot.id } } as const)
    : task
      ? ({ to: '/tasks/$taskId', params: { taskId: task.id } } as const)
      : ({ to: '/calendar' } as const);

  const [crew, date, startTime, endTime] = useWatch({
    control: form.control,
    name: ['crew', 'date', 'startTime', 'endTime'],
  });
  const { dirtyFields } = form.formState;
  const timeChanged = !!(dirtyFields.date || dirtyFields.startTime || dirtyFields.endTime);
  // An edit that leaves the time alone keeps the shoot's own instants (a shoot of several days).
  const instants =
    shoot && !timeChanged
      ? { startsAt: shoot.startsAt, endsAt: shoot.endsAt }
      : instantsOf({ date, startTime, endTime });
  const crewIds = crew.map((member) => member.userId).filter(Boolean);
  const live = useQuery({
    ...conflictsQuery({
      userIds: crewIds,
      startsAt: instants?.startsAt ?? '',
      endsAt: instants?.endsAt ?? '',
      excludeShootId: shoot?.id,
    }),
    enabled: crewIds.length > 0 && !!instants,
  });
  const conflicts = crewIds.length > 0 && instants ? (live.data?.items ?? []) : [];

  /** Shows the first problem of each part of the form the contract refused. */
  function report(values: ShootFormValues, issues: readonly { path: PropertyKey[] }[]) {
    const found: Problems = {};
    for (const issue of issues) {
      const problem = PROBLEM_OF_FIELD[String(issue.path[0])];
      if (problem && onScreen(problem, values)) {
        found[problem] ??= t(`calendar.form.errors.${problem}`);
      }
    }
    setProblems(found);
    if (Object.keys(found).length === 0) setFailure(t('errors.generic'));
  }

  /**
   * Whether the part of the form a problem belongs to is shown: the client and the task are
   * fixed on an edit and on a booking from a task, and the links belong to a new task of a
   * client. A problem of a hidden part shows above the buttons instead.
   */
  function onScreen(problem: Problem, values: ShootFormValues) {
    if (problem === 'client' || problem === 'task') return !fixed;
    if (problem === 'links') {
      return !fixed && !!values.client && values.client !== INTERNAL && values.task === NEW_TASK;
    }
    return true;
  }

  async function save(values: ShootFormValues, acceptConflicts: boolean) {
    setProblems({});
    setFailure(null);
    if (!values.crew.some((member) => member.isLead)) {
      setProblems({ crew: t('errors.LEAD_REQUIRED') });
      return;
    }
    const fields = {
      title: values.title,
      type: values.type,
      location: values.location,
      mapUrl: values.mapUrl.trim() || null,
      brief: values.brief,
      crew: values.crew,
      externalCrew: values.externalCrew,
      acceptConflicts,
    };
    const shots = {
      shots: values.shots.map(({ id, text, note }) => ({ id, text, note })),
    };
    try {
      if (shoot) {
        const input = updateShootSchema.safeParse({
          ...fields,
          ...(timeChanged && (instantsOf(values) ?? { startsAt: '', endsAt: '' })),
        });
        const list = shotListInputSchema.safeParse(shots);
        if (!input.success) return report(values, input.error.issues);
        if (!list.success) return report(values, list.error.issues);
        if (conflicts.length > 0 && !acceptConflicts) return setConfirming(conflicts);
        await update.mutateAsync(input.data);
        if (dirtyFields.shots) await saveShots.mutateAsync(list.data);
        toast.add({ title: t('calendar.form.saved'), type: 'success' });
        await navigate({ to: '/shoots/$shootId', params: { shootId: shoot.id } });
        return;
      }
      const input = createShootSchema.safeParse({
        ...fields,
        ...(instantsOf(values) ?? { startsAt: '', endsAt: '' }),
        shots: shots.shots,
        ...(values.task === NEW_TASK
          ? {
              clientId: values.client === INTERNAL ? null : values.client,
              newTask: {
                projectId: values.projectId,
                milestoneId: values.milestoneId,
                retainerCycleId: values.retainerCycleId,
                cycleLineId: values.cycleLineId,
              },
            }
          : { taskId: values.task }),
      });
      if (!input.success) return report(values, input.error.issues);
      if (conflicts.length > 0 && !acceptConflicts) return setConfirming(conflicts);
      const created = await create.mutateAsync(input.data);
      toast.add({ title: t('calendar.form.booked'), type: 'success' });
      await navigate({ to: '/shoots/$shootId', params: { shootId: created.id } });
    } catch (error) {
      // Someone was booked elsewhere after the form last checked: ask before saving anyway.
      if (error instanceof ApiError && error.code === 'SCHEDULE_CONFLICT' && !acceptConflicts) {
        setConfirming(Array.isArray(error.details) ? (error.details as ScheduleConflict[]) : []);
        return;
      }
      const problem = error instanceof ApiError ? PROBLEM_OF_CODE[error.code ?? ''] : undefined;
      if (problem && onScreen(problem, values)) setProblems({ [problem]: errorMessage(t, error) });
      else setFailure(errorMessage(t, error));
    }
  }

  const pending = form.formState.isSubmitting;

  return (
    <>
      <form
        className="flex max-w-4xl flex-col gap-6"
        onSubmit={form.handleSubmit((values) => save(values, false))}
        noValidate
      >
        <FormSection title={t('calendar.form.what')} hint={t('calendar.form.whatHint')}>
          <Field invalid={!!problems.title}>
            <FieldLabel>{t('calendar.form.title')}</FieldLabel>
            <Input
              autoComplete="off"
              maxLength={CALENDAR_LIMITS.title}
              placeholder={t('calendar.form.titlePlaceholder')}
              {...form.register('title')}
            />
            <FieldError match={!!problems.title}>{problems.title}</FieldError>
          </Field>
          <TypeField form={form} problem={problems.type} />
          {fixed ? (
            <FixedWork shoot={shoot} task={task} />
          ) : (
            <WorkFields form={form} problems={problems} scopeAll={scopeAll} />
          )}
          <Field invalid={!!problems.brief}>
            <FieldLabel>
              {t('calendar.form.brief')}
              <Optional />
            </FieldLabel>
            <Textarea
              rows={4}
              maxLength={CALENDAR_LIMITS.brief}
              placeholder={t('calendar.form.briefPlaceholder')}
              {...form.register('brief')}
            />
            <FieldError match={!!problems.brief}>{problems.brief}</FieldError>
          </Field>
        </FormSection>

        <FormSection title={t('calendar.form.when')} hint={t('calendar.form.whenHint')}>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field invalid={!!problems.time}>
              <FieldLabel>{t('calendar.form.date')}</FieldLabel>
              <Input type="date" {...form.register('date')} />
            </Field>
            <Field invalid={!!problems.time}>
              <FieldLabel>{t('calendar.form.startTime')}</FieldLabel>
              <Input type="time" {...form.register('startTime')} />
            </Field>
            <Field invalid={!!problems.time}>
              <FieldLabel>{t('calendar.form.endTime')}</FieldLabel>
              <Input type="time" {...form.register('endTime')} />
            </Field>
          </div>
          {problems.time ? (
            <p role="alert" className="text-sm text-destructive-text">
              {problems.time}
            </p>
          ) : (
            startTime &&
            endTime &&
            endTime <= startTime && (
              <p className="text-sm text-muted-foreground">{t('calendar.form.endsNextDay')}</p>
            )
          )}
          <Field invalid={!!problems.location}>
            <FieldLabel>{t('calendar.form.location')}</FieldLabel>
            <Input
              maxLength={CALENDAR_LIMITS.location}
              placeholder={t('calendar.form.locationPlaceholder')}
              {...form.register('location')}
            />
            <FieldError match={!!problems.location}>{problems.location}</FieldError>
          </Field>
          <Field invalid={!!problems.mapUrl}>
            <FieldLabel>
              {t('calendar.form.mapUrl')}
              <Optional />
            </FieldLabel>
            <Input
              type="url"
              dir="ltr"
              placeholder="https://maps.app.goo.gl/…"
              {...form.register('mapUrl')}
            />
            <FieldError match={!!problems.mapUrl}>{problems.mapUrl}</FieldError>
          </Field>
        </FormSection>

        <FormSection title={t('calendar.form.who')} hint={t('calendar.form.whoHint')}>
          <CrewField form={form} shoot={shoot} problem={problems.crew} />
          {conflicts.length > 0 && (
            <Callout
              tone="warning"
              icon={<TriangleAlertIcon />}
              title={t('calendar.form.conflictsTitle')}
              description={t('calendar.form.conflictsBody')}
              className="sm:flex-col sm:items-stretch"
              action={<ConflictList conflicts={conflicts} />}
            />
          )}
          <ExternalCrewField form={form} problem={problems.externalCrew} />
        </FormSection>

        <FormSection title={t('calendar.form.shots')} hint={t('calendar.form.shotsHint')}>
          <ShotsField form={form} problem={problems.shots} />
        </FormSection>

        {failure && <FormAlert>{failure}</FormAlert>}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button variant="outline" render={<Link {...back} />}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={pending}>
            {shoot
              ? pending
                ? t('calendar.form.saving')
                : t('calendar.form.save')
              : pending
                ? t('calendar.form.booking')
                : t('calendar.form.book')}
          </Button>
        </div>
      </form>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('calendar.form.confirmConflictsTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('calendar.form.confirmConflictsBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ConflictList conflicts={confirming ?? []} />
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t('common.cancel')}
            </AlertDialogClose>
            <Button
              disabled={pending}
              onClick={() => {
                setConfirming(null);
                return form.handleSubmit((values) => save(values, true))();
              }}
            >
              {t('calendar.form.saveAnyway')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const Optional = () => {
  const { t } = useTranslation();
  return <span className="ms-1 font-normal text-muted-foreground">({t('common.optional')})</span>;
};

function TypeField({ form, problem }: { form: FormMethods; problem?: string }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Field invalid={!!problem}>
      <FieldLabel id={id} render={<span />}>
        {t('calendar.form.type')}
      </FieldLabel>
      <Controller
        control={form.control}
        name="type"
        render={({ field }) => (
          <ToggleGroup
            aria-labelledby={id}
            className="flex-wrap"
            value={field.value ? [field.value] : []}
            onValueChange={(next: ShootType[]) => {
              if (next[0]) field.onChange(next[0]);
            }}
          >
            {SHOOT_TYPES.map((type) => {
              const Icon = SHOOT_TYPE_ICONS[type];
              return (
                <ToggleGroupItem key={type} value={type}>
                  <Icon aria-hidden="true" />
                  {t(`calendar.shootTypes.${type}`)}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        )}
      />
      <FieldError match={!!problem}>{problem}</FieldError>
    </Field>
  );
}

/** The client and the shoot task of an edit, or of a booking started from a task: never changed. */
function FixedWork({ shoot, task }: { shoot?: ShootDetail; task?: TaskDetail }) {
  const { t } = useTranslation();
  const client = (shoot ?? task)?.client;
  const work = shoot?.task ?? task;
  return (
    <dl className="grid gap-4 rounded-md border border-border bg-muted/50 p-4 text-sm sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="text-xs text-muted-foreground">{t('calendar.form.client')}</dt>
        <dd className="font-medium">{client?.name ?? t('calendar.internal')}</dd>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="text-xs text-muted-foreground">{t('calendar.form.task')}</dt>
        <dd className="truncate font-medium">{work?.title}</dd>
      </div>
    </dl>
  );
}

/**
 * The client (own clients for an account manager; "No client" for scope all), then the shoot
 * task: one of the client's bookable Photography tasks, or a new one with its links (rules 1–3).
 */
function WorkFields({
  form,
  problems,
  scopeAll,
}: {
  form: FormMethods;
  problems: Problems;
  scopeAll: boolean;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const clients = useClientOptions().filter((client) =>
    canBookShootsOf(me, client.accountManagerId),
  );
  const [client, task] = useWatch({ control: form.control, name: ['client', 'task'] });
  const clientId = client && client !== INTERNAL ? client : undefined;
  // Open Photography tasks that no post delivers (rule 2); the API refuses one already booked.
  const tasks = useQuery({
    ...taskListQuery({
      department: [SHOOT_DEPARTMENT],
      linkedToPost: 'false',
      ...(clientId ? { clientId } : { internal: 'true' }),
      pageSize: 100,
    }),
    enabled: !!client,
    placeholderData: undefined,
  });
  const clientItems = [
    ...(scopeAll ? [{ value: INTERNAL, label: t('calendar.form.noClient') }] : []),
    ...clients.map((option) => ({ value: option.id, label: option.name })),
  ];
  const taskItems = [
    { value: NEW_TASK, label: t('calendar.form.newTask') },
    ...(tasks.data?.items ?? []).map((item) => ({ value: item.id, label: item.title })),
  ];

  function resetWork() {
    form.setValue('task', NEW_TASK);
    for (const name of ['projectId', 'milestoneId', 'retainerCycleId', 'cycleLineId'] as const)
      form.setValue(name, null);
  }

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field invalid={!!problems.client}>
          <FieldLabel>{t('calendar.form.client')}</FieldLabel>
          <Controller
            control={form.control}
            name="client"
            render={({ field }) => (
              <Select
                items={clientItems}
                value={field.value || null}
                onValueChange={(value) => {
                  if (!value || value === field.value) return;
                  field.onChange(value);
                  resetWork();
                }}
              >
                <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
                  <SelectValue placeholder={t('calendar.form.clientPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {clientItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.value === INTERNAL ? (
                        <span className="text-muted-foreground">{item.label}</span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <Avatar name={item.label} shape="square" size="sm" />
                          {item.label}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldError match={!!problems.client}>{problems.client}</FieldError>
        </Field>
        <Field invalid={!!problems.task}>
          <FieldLabel>{t('calendar.form.task')}</FieldLabel>
          <Controller
            control={form.control}
            name="task"
            render={({ field }) => (
              <Select
                items={taskItems}
                value={field.value}
                disabled={!client}
                onValueChange={(value) => value && field.onChange(value)}
              >
                <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {taskItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldDescription>{t('calendar.form.taskHint')}</FieldDescription>
          <FieldError match={!!problems.task}>{problems.task}</FieldError>
        </Field>
      </div>
      {clientId && task === NEW_TASK && (
        <LinkFields form={form} clientId={clientId} problem={problems.links} />
      )}
    </>
  );
}

/**
 * Where the new shoot task belongs: a project and optionally one of its pending milestones, or a
 * retainer's open cycle and optionally one of its lines (rule 3, F06 rule 7).
 */
function LinkFields({
  form,
  clientId,
  problem,
}: {
  form: FormMethods;
  clientId: string;
  problem?: string;
}) {
  const { t } = useTranslation();
  const [projectId, cycleId, milestoneId, cycleLineId] = useWatch({
    control: form.control,
    name: ['projectId', 'retainerCycleId', 'milestoneId', 'cycleLineId'],
  });
  // No placeholder: another client's projects must never be offered while these load.
  const projects = useQuery({
    ...projectListQuery({ clientId, pageSize: 100 }),
    placeholderData: undefined,
  });
  const retainers = useQuery({
    ...retainerListQuery({ clientId, pageSize: 100 }),
    placeholderData: undefined,
  });
  const project = useQuery({ ...projectQuery(projectId ?? ''), enabled: !!projectId });
  const cycles = (retainers.data?.items ?? []).flatMap((retainer) =>
    retainer.currentCycle ? [{ retainer, cycle: retainer.currentCycle }] : [],
  );
  const engagementItems = [
    { value: NONE, label: t('tasks.form.noEngagement') },
    ...(projects.data?.items ?? []).map((item) => ({
      value: `project:${item.id}`,
      label: item.name,
    })),
    ...cycles.map(({ retainer, cycle }) => ({
      value: `cycle:${cycle.id}`,
      label: t('tasks.form.retainerCycle', {
        retainer: retainer.name,
        month: formatMonth(cycle.periodStart),
      }),
    })),
  ];
  const milestoneItems = [
    { value: NONE, label: t('tasks.form.noMilestone') },
    ...(project.data?.milestones ?? [])
      .filter((milestone) => milestone.status === 'pending')
      .map((milestone) => ({ value: milestone.id, label: milestone.name })),
  ];
  const lineItems = [
    { value: NONE, label: t('tasks.form.noLine') },
    ...(cycles.find(({ cycle }) => cycle.id === cycleId)?.cycle.lines ?? []).map((line) => ({
      value: line.id,
      label: lineName(t, line),
    })),
  ];
  const pick = (value: string | null) => (!value || value === NONE ? null : value);

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field invalid={!!problem}>
        <FieldLabel>
          {t('tasks.form.engagement')}
          <Optional />
        </FieldLabel>
        <Select
          items={engagementItems}
          value={projectId ? `project:${projectId}` : cycleId ? `cycle:${cycleId}` : NONE}
          onValueChange={(next) => {
            const [kind, id] = (next ?? NONE).split(':');
            form.setValue('projectId', kind === 'project' ? (id ?? null) : null);
            form.setValue('retainerCycleId', kind === 'cycle' ? (id ?? null) : null);
            form.setValue('milestoneId', null);
            form.setValue('cycleLineId', null);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {engagementItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>{t('calendar.form.linksHint')}</FieldDescription>
        <FieldError match={!!problem}>{problem}</FieldError>
      </Field>
      {projectId && (
        <Field>
          <FieldLabel>
            {t('tasks.form.milestone')}
            <Optional />
          </FieldLabel>
          <Select
            items={milestoneItems}
            value={milestoneId ?? NONE}
            onValueChange={(next) => form.setValue('milestoneId', pick(next))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {milestoneItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {cycleId && (
        <Field>
          <FieldLabel>
            {t('tasks.form.line')}
            <Optional />
          </FieldLabel>
          <Select
            items={lineItems}
            value={cycleLineId ?? NONE}
            onValueChange={(next) => form.setValue('cycleLineId', pick(next))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {lineItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{t('tasks.form.lineHint')}</FieldDescription>
        </Field>
      )}
    </div>
  );
}

/**
 * Rows under one name. Each control of a row keeps its own label (a `Field` would name them all
 * after the group); the group shares the hint and the problem.
 */
function RowGroup({
  label,
  name,
  hint,
  problem,
  children,
}: {
  label?: ReactNode;
  /** Names the group when it has no visible label. */
  name?: string;
  hint?: string;
  problem?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset's legend cannot sit in this layout
    <div
      role="group"
      aria-label={name}
      aria-labelledby={label ? id : undefined}
      className="flex flex-col gap-2"
    >
      {label && (
        <span id={id} className="text-sm font-medium">
          {label}
        </span>
      )}
      {children}
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {problem && (
        <p role="alert" className="text-sm text-destructive-text">
          {problem}
        </p>
      )}
    </div>
  );
}

function RoleSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CrewRole;
  onChange: (role: CrewRole) => void;
}) {
  const { t } = useTranslation();
  const items = CREW_ROLES.map((role) => ({ value: role, label: t(`calendar.crewRoles.${role}`) }));
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => next && onChange(next as CrewRole)}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Rule 6: 1–10 team members of any department, each with a role, exactly one the lead. */
function CrewField({
  form,
  shoot,
  problem,
}: {
  form: FormMethods;
  shoot?: ShootDetail;
  problem?: string;
}) {
  const { t } = useTranslation();
  const rows = useFieldArray({ control: form.control, name: 'crew', keyName: 'key' });
  const crew = useWatch({ control: form.control, name: 'crew' });
  const users = useQuery(userListQuery({ pageSize: 100 }));
  // A member archived after the booking stays listed (rule 6) and is not in the active list.
  const people = [
    ...(users.data?.items ?? []).map((user) => ({ id: user.id, name: user.name })),
    ...(shoot?.crew ?? []).filter(({ user }) => user.archived).map(({ user }) => user),
  ];

  return (
    <RowGroup label={t('calendar.form.crew')} problem={problem}>
      <ul className="flex flex-col gap-2">
        {rows.fields.map((row, index) => {
          const member = crew[index] ?? row;
          const taken = crew.filter((_, other) => other !== index).map((other) => other.userId);
          const items = people
            .filter((person) => !taken.includes(person.id))
            .map((person) => ({ value: person.id, label: person.name }));
          return (
            <li
              key={row.key}
              className="grid items-center gap-2 rounded-md border border-border p-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto_auto]"
            >
              <Select
                items={items}
                value={member.userId || null}
                onValueChange={(next) => next && form.setValue(`crew.${index}.userId`, next)}
              >
                <SelectTrigger aria-label={t('calendar.form.crewMember')}>
                  <SelectValue placeholder={t('calendar.form.crewMemberPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      <span className="flex items-center gap-2">
                        <Avatar name={item.label} size="sm" />
                        {item.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <RoleSelect
                label={t('calendar.form.crewRole')}
                value={member.role}
                onChange={(role) => form.setValue(`crew.${index}.role`, role)}
              />
              <Button
                type="button"
                variant={member.isLead ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={member.isLead}
                onClick={() =>
                  form.setValue(
                    'crew',
                    crew.map((other, position) => ({ ...other, isLead: position === index })),
                    { shouldDirty: true },
                  )
                }
              >
                <StarIcon />
                {t('calendar.form.lead')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="justify-self-end"
                aria-label={t('calendar.form.removeCrew')}
                disabled={rows.fields.length === 1}
                onClick={() => rows.remove(index)}
              >
                <XIcon />
              </Button>
            </li>
          );
        })}
      </ul>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.fields.length >= CALENDAR_LIMITS.crew}
          onClick={() => rows.append({ userId: '', role: 'assistant', isLead: false })}
        >
          <PlusIcon />
          {t('calendar.form.addCrew')}
        </Button>
      </div>
    </RowGroup>
  );
}

/** Freelancers by name: never checked for conflicts (rule 5). */
function ExternalCrewField({ form, problem }: { form: FormMethods; problem?: string }) {
  const { t } = useTranslation();
  const rows = useFieldArray({ control: form.control, name: 'externalCrew', keyName: 'key' });
  return (
    <RowGroup
      label={
        <>
          {t('calendar.form.externalCrew')}
          <Optional />
        </>
      }
      hint={t('calendar.form.externalHint')}
      problem={problem}
    >
      {rows.fields.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.fields.map((row, index) => (
            <li
              key={row.key}
              className="grid items-center gap-2 rounded-md border border-border p-2 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]"
            >
              <Input
                aria-label={t('calendar.form.externalName')}
                placeholder={t('calendar.form.externalName')}
                maxLength={CALENDAR_LIMITS.externalCrewName}
                {...form.register(`externalCrew.${index}.name`)}
              />
              <Controller
                control={form.control}
                name={`externalCrew.${index}.role`}
                render={({ field }) => (
                  <RoleSelect
                    label={t('calendar.form.crewRole')}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
              <Input
                type="tel"
                dir="ltr"
                aria-label={t('calendar.form.externalPhone')}
                placeholder={t('calendar.form.externalPhone')}
                className="placeholder:text-end"
                {...form.register(`externalCrew.${index}.phone`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="justify-self-end"
                aria-label={t('calendar.form.removeExternal')}
                onClick={() => rows.remove(index)}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.fields.length >= CALENDAR_LIMITS.externalCrew}
          onClick={() => rows.append({ name: '', role: 'assistant', phone: '' })}
        >
          <PlusIcon />
          {t('calendar.form.addExternal')}
        </Button>
      </div>
    </RowGroup>
  );
}

/** The shots the client asked for, in order; kept items keep their ticks (rule 7). */
function ShotsField({ form, problem }: { form: FormMethods; problem?: string }) {
  const { t } = useTranslation();
  const rows = useFieldArray({ control: form.control, name: 'shots', keyName: 'key' });
  return (
    <RowGroup name={t('calendar.form.shots')} problem={problem}>
      {rows.fields.length > 0 && (
        <ol className="flex flex-col gap-2">
          {rows.fields.map((row, index) => (
            <li
              key={row.key}
              className="grid items-center gap-2 rounded-md border border-border p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <Input
                aria-label={t('calendar.form.shotText', { n: index + 1 })}
                placeholder={t('calendar.form.shotTextPlaceholder')}
                maxLength={CALENDAR_LIMITS.shotText}
                {...form.register(`shots.${index}.text`)}
              />
              <Input
                aria-label={t('calendar.form.shotNote', { n: index + 1 })}
                placeholder={t('calendar.form.shotNotePlaceholder')}
                maxLength={CALENDAR_LIMITS.shotNote}
                {...form.register(`shots.${index}.note`)}
              />
              <span className="flex items-center justify-self-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('calendar.form.moveShotUp', { n: index + 1 })}
                  disabled={index === 0}
                  onClick={() => rows.move(index, index - 1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('calendar.form.moveShotDown', { n: index + 1 })}
                  disabled={index === rows.fields.length - 1}
                  onClick={() => rows.move(index, index + 1)}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('calendar.form.removeShot', { n: index + 1 })}
                  onClick={() => rows.remove(index)}
                >
                  <XIcon />
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.fields.length >= CALENDAR_LIMITS.shots}
          onClick={() => rows.append({ text: '', note: '' })}
        >
          <PlusIcon />
          {t('calendar.form.addShot')}
        </Button>
      </div>
    </RowGroup>
  );
}
