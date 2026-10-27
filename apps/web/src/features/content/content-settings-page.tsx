import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  addDays,
  businessDate,
  CONTENT_PLANNING_LIMITS,
  type ContentOccasion,
  type ContentPillar,
  createContentOccasionSchema,
  createContentPillarSchema,
  OCCASION_CALENDARS,
  OCCASION_CATEGORIES,
  type OccasionCalendar,
  type OccasionCategory,
  occasionRuleProblem,
  PILLAR_COLORS,
  type PillarColor,
  type PostingWindow,
  updateContentAgencySettingsSchema,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  ChartDot,
  cn,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  CalendarCheckIcon,
  CalendarHeartIcon,
  PencilIcon,
  PlusIcon,
} from 'lucide-react';
import { useId, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { canAll, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatCalendarDate, formatMonthName, formatNumber } from '../../lib/format';
import { FormDialog } from '../quotes/quote-dialogs';
import {
  agencyContentSettingsQuery,
  contentOccasionsQuery,
  contentPillarsQuery,
  useArchiveOccasion,
  useArchivePillar,
  useClearOccasionDate,
  useConfirmOccasionDate,
  useCreateOccasion,
  useCreatePillar,
  useOrderPillars,
  useRestoreOccasion,
  useRestorePillar,
  useUpdateAgencySettings,
  useUpdateOccasion,
  useUpdatePillar,
} from './content.queries';
import { PostingTimesEditor } from './posting-times-editor';
import { SnippetsManager } from './snippets-manager';

/*
 * Content settings (spec F08B screen 6): the agency's pillars (rule C1), occasions and their
 * dates (C5), default best times (C3) and snippets (A10). `content.review` with scope all edits;
 * everyone else reads.
 */

/** How far ahead the occasions are listed, by next date (the API's widest range). */
const OCCASION_DAYS = CONTENT_PLANNING_LIMITS.occasionDays;

export function ContentSettingsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const manages = canAll(me, 'content.review');
  return (
    <>
      <PageHeader
        title={t('content.settings.title')}
        description={manages ? t('content.settings.subtitle') : t('content.settings.readOnly')}
        actions={
          <Button variant="ghost" render={<Link to="/content" />}>
            {t('content.settings.back')}
            <ArrowLeftIcon className="ltr:-scale-x-100" />
          </Button>
        }
      />
      <div className="flex flex-col gap-6">
        <FormSection title={t('content.settings.pillars')} hint={t('content.settings.pillarsHint')}>
          <PillarsSection manages={manages} />
        </FormSection>
        <FormSection
          title={t('content.settings.occasions')}
          hint={t('content.settings.occasionsHint')}
        >
          <OccasionsSection manages={manages} />
        </FormSection>
        <FormSection title={t('content.settings.times')} hint={t('content.settings.timesHint')}>
          <TimesSection manages={manages} />
        </FormSection>
        <FormSection
          title={t('content.settings.snippets')}
          hint={t('content.settings.snippetsHint')}
        >
          <SnippetsManager clientId={null} canEdit={manages} />
        </FormSection>
      </div>
    </>
  );
}

// Pillars (rule C1)

function PillarsSection({ manages }: { manages: boolean }) {
  const { t } = useTranslation();
  const pillars = useQuery(contentPillarsQuery);
  const order = useOrderPillars();
  const archive = useArchivePillar();
  const restore = useRestorePillar();
  const [editing, setEditing] = useState<ContentPillar | 'new' | null>(null);
  const [archiving, setArchiving] = useState<ContentPillar | null>(null);
  if (pillars.isPending) return <Skeleton className="h-40" />;
  if (pillars.isError) {
    return (
      <LoadError message={t('content.settings.loadError')} onRetry={() => pillars.refetch()} />
    );
  }
  const live = pillars.data.items.filter((pillar) => !pillar.archived);
  const archived = pillars.data.items.filter((pillar) => pillar.archived);

  async function move(index: number, step: -1 | 1) {
    const ids = live.map((pillar) => pillar.id);
    const [moved] = ids.splice(index, 1);
    if (!moved) return;
    ids.splice(index + step, 0, moved);
    try {
      await order.mutateAsync({ ids });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  async function bringBack(pillar: ContentPillar) {
    try {
      await restore.mutateAsync(pillar.id);
      toast.add({ title: t('content.settings.pillarRestored'), type: 'success' });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  return (
    <div className="flex flex-col gap-3" data-pillars>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {[...live, ...archived].map((pillar) => {
          const index = live.indexOf(pillar);
          return (
            <li
              key={pillar.id}
              data-pillar={pillar.id}
              className={cn('flex items-center gap-3 px-3 py-2', pillar.archived && 'opacity-60')}
            >
              <ChartDot color={pillar.color} muted={pillar.archived} />
              <span className="flex-1 font-medium">{pillar.name}</span>
              {pillar.archived && <Badge tone="neutral">{t('content.archivedBadge')}</Badge>}
              {manages &&
                (pillar.archived ? (
                  <IconButton
                    label={t('content.settings.restorePillar', { name: pillar.name })}
                    disabled={live.length >= CONTENT_PLANNING_LIMITS.pillars}
                    onClick={() => void bringBack(pillar)}
                  >
                    <ArchiveRestoreIcon />
                  </IconButton>
                ) : (
                  <span className="flex items-center gap-1">
                    <IconButton
                      label={t('content.settings.earlier', { name: pillar.name })}
                      disabled={index === 0 || order.isPending}
                      onClick={() => void move(index, -1)}
                    >
                      <ArrowUpIcon />
                    </IconButton>
                    <IconButton
                      label={t('content.settings.later', { name: pillar.name })}
                      disabled={index === live.length - 1 || order.isPending}
                      onClick={() => void move(index, 1)}
                    >
                      <ArrowDownIcon />
                    </IconButton>
                    <IconButton
                      label={t('content.settings.editPillar', { name: pillar.name })}
                      onClick={() => setEditing(pillar)}
                    >
                      <PencilIcon />
                    </IconButton>
                    <IconButton
                      label={t('content.settings.archivePillar', { name: pillar.name })}
                      onClick={() => setArchiving(pillar)}
                    >
                      <ArchiveIcon />
                    </IconButton>
                  </span>
                ))}
            </li>
          );
        })}
      </ul>
      {manages && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={live.length >= CONTENT_PLANNING_LIMITS.pillars}
            onClick={() => setEditing('new')}
          >
            <PlusIcon />
            {t('content.settings.addPillar')}
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('content.settings.pillarCount', {
              n: formatNumber(live.length),
              max: formatNumber(CONTENT_PLANNING_LIMITS.pillars),
            })}
          </span>
        </div>
      )}
      <PillarDialog
        pillar={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={t('content.settings.archivePillarTitle', { name: archiving?.name ?? '' })}
        body={t('content.settings.archivePillarBody')}
        action={t('content.settings.archiveAction')}
        pending={archive.isPending}
        onConfirm={async () => {
          if (!archiving) return;
          await archive.mutateAsync(archiving.id);
          toast.add({ title: t('content.settings.pillarArchived'), type: 'success' });
        }}
      />
    </div>
  );
}

function PillarDialog({
  pillar,
  open,
  onClose,
}: {
  pillar: ContentPillar | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const nameId = useId();
  const colorId = useId();
  const create = useCreatePillar();
  const update = useUpdatePillar();
  const [failure, setFailure] = useState<string | null>(null);
  const defaults = { name: pillar?.name ?? '', color: pillar?.color ?? PILLAR_COLORS[0] };
  const form = useForm<{ name: string; color: PillarColor }>({ values: defaults });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const checked = createContentPillarSchema.safeParse(values);
    if (!checked.success) {
      form.setError('name', { type: 'schema' });
      return;
    }
    try {
      if (pillar) await update.mutateAsync({ id: pillar.id, ...checked.data });
      else await create.mutateAsync(checked.data);
      toast.add({ title: t('content.settings.pillarSaved'), type: 'success' });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.knownCode === 'NAME_TAKEN') {
        form.setError('name', { type: 'server' });
        return;
      }
      setFailure(errorMessage(t, error));
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
      submitting={form.formState.isSubmitting}
      title={pillar ? t('content.settings.editPillarTitle') : t('content.settings.addPillar')}
      description={t('content.settings.pillarHint')}
      action={t('common.save')}
      failure={failure}
      onSubmit={submit}
    >
      <Field invalid={!!errors.name}>
        <FieldLabel htmlFor={nameId}>{t('content.settings.pillarName')}</FieldLabel>
        <Input
          id={nameId}
          maxLength={CONTENT_PLANNING_LIMITS.pillarName}
          {...form.register('name')}
        />
        <FieldError
          match={!!errors.name}
          role={errors.name?.type === 'server' ? 'alert' : undefined}
        >
          {errors.name?.type === 'server'
            ? t('errors.NAME_TAKEN')
            : t('content.settings.pillarNameError')}
        </FieldError>
      </Field>
      <Field>
        <FieldLabel id={colorId}>{t('content.settings.pillarColor')}</FieldLabel>
        <Controller
          control={form.control}
          name="color"
          render={({ field }) => (
            <ToggleGroup
              aria-labelledby={colorId}
              value={[field.value]}
              onValueChange={(next: PillarColor[]) => next[0] && field.onChange(next[0])}
            >
              {PILLAR_COLORS.map((color, index) => (
                <ToggleGroupItem
                  key={color}
                  value={color}
                  aria-label={t('content.settings.colorN', { n: index + 1 })}
                  className="size-9 px-0"
                >
                  <ChartDot color={color} className="size-4" />
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        />
      </Field>
    </FormDialog>
  );
}

// Occasions (rules C4, C5)

function OccasionsSection({ manages }: { manages: boolean }) {
  const { t } = useTranslation();
  const today = businessDate();
  const occasions = useQuery(
    contentOccasionsQuery({
      from: today,
      to: addDays(today, OCCASION_DAYS - 1),
      ...(manages && { includeArchived: 'true' as const }),
    }),
  );
  const archive = useArchiveOccasion();
  const restore = useRestoreOccasion();
  const [editing, setEditing] = useState<ContentOccasion | 'new' | null>(null);
  const [confirming, setConfirming] = useState<ContentOccasion | null>(null);
  const [archiving, setArchiving] = useState<ContentOccasion | null>(null);
  if (occasions.isPending) return <Skeleton className="h-40" />;
  if (occasions.isError) {
    return (
      <LoadError message={t('content.settings.loadError')} onRetry={() => occasions.refetch()} />
    );
  }
  const items = occasions.data.items;

  async function bringBack(occasion: ContentOccasion) {
    try {
      await restore.mutateAsync(occasion.id);
      toast.add({ title: t('content.settings.occasionRestored'), type: 'success' });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  return (
    <div className="flex flex-col gap-3" data-occasions>
      {items.length === 0 ? (
        <EmptyState icon={<CalendarHeartIcon />} title={t('content.settings.noOccasions')} />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {items.map((occasion) => {
            const next = occasion.occurrences[0];
            return (
              <li
                key={occasion.id}
                data-occasion-row={occasion.id}
                className={cn(
                  'flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center',
                  occasion.archived && 'opacity-60',
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-medium">{occasion.name}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge tone="outline">
                      {occasion.client
                        ? occasion.client.name
                        : t(`content.occasions.categories.${occasion.category}`)}
                    </Badge>
                    <span>{t(`content.occasions.calendars.${occasion.calendar}`)}</span>
                    {next && (
                      <span className="tabular-nums">
                        {next.startDate === next.endDate
                          ? formatCalendarDate(next.startDate)
                          : t('content.occasions.range', {
                              from: formatCalendarDate(next.startDate),
                              to: formatCalendarDate(next.endDate),
                            })}
                      </span>
                    )}
                    {next && occasion.calendar === 'hijri' && (
                      <Badge tone={next.confirmed ? 'success' : 'neutral'}>
                        {next.confirmed
                          ? t('content.occasions.confirmed')
                          : t('content.occasions.computed')}
                      </Badge>
                    )}
                    {occasion.archived && (
                      <Badge tone="neutral">{t('content.archivedBadge')}</Badge>
                    )}
                  </span>
                </div>
                {manages && (
                  <span className="flex items-center gap-1">
                    {occasion.archived ? (
                      <IconButton
                        label={t('content.settings.restoreOccasion', { name: occasion.name })}
                        onClick={() => void bringBack(occasion)}
                      >
                        <ArchiveRestoreIcon />
                      </IconButton>
                    ) : (
                      <>
                        {occasion.calendar === 'hijri' && next && (
                          <IconButton
                            label={t('content.settings.confirmDate', { name: occasion.name })}
                            onClick={() => setConfirming(occasion)}
                          >
                            <CalendarCheckIcon />
                          </IconButton>
                        )}
                        <IconButton
                          label={t('content.settings.editOccasion', { name: occasion.name })}
                          onClick={() => setEditing(occasion)}
                        >
                          <PencilIcon />
                        </IconButton>
                        <IconButton
                          label={t('content.settings.archiveOccasion', { name: occasion.name })}
                          onClick={() => setArchiving(occasion)}
                        >
                          <ArchiveIcon />
                        </IconButton>
                      </>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {manages && (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => setEditing('new')}>
          <PlusIcon />
          {t('content.settings.addOccasion')}
        </Button>
      )}
      <OccasionDialog
        occasion={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      <ConfirmDateDialog occasion={confirming} onClose={() => setConfirming(null)} />
      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={t('content.settings.archiveOccasionTitle', { name: archiving?.name ?? '' })}
        body={t('content.settings.archiveOccasionBody')}
        action={t('content.settings.archiveAction')}
        pending={archive.isPending}
        onConfirm={async () => {
          if (!archiving) return;
          await archive.mutateAsync(archiving.id);
          toast.add({ title: t('content.settings.occasionArchived'), type: 'success' });
        }}
      />
    </div>
  );
}

interface OccasionValues {
  name: string;
  category: OccasionCategory;
  calendar: OccasionCalendar;
  month: string;
  day: string;
  date: string;
  durationDays: string;
  leadDays: string;
}

/** The Hijri months' keys, 1 to 12. */
const HIJRI_MONTHS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;

function OccasionDialog({
  occasion,
  open,
  onClose,
}: {
  occasion: ContentOccasion | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const create = useCreateOccasion();
  const update = useUpdateOccasion();
  const [failure, setFailure] = useState<string | null>(null);
  const defaults: OccasionValues = {
    name: occasion?.name ?? '',
    category: occasion?.category ?? 'general',
    calendar: occasion?.calendar ?? 'gregorian',
    month: occasion?.month ? String(occasion.month) : '1',
    day: occasion?.day ? String(occasion.day) : '',
    date: occasion?.date ?? '',
    durationDays: String(occasion?.durationDays ?? 1),
    leadDays: String(occasion?.leadDays ?? 7),
  };
  const form = useForm<OccasionValues>({ values: defaults });
  const { errors } = form.formState;
  const calendar = useWatch({ control: form.control, name: 'calendar' });
  const monthItems = HIJRI_MONTHS.map((month) => ({
    value: month,
    label:
      calendar === 'hijri'
        ? t(`content.occasions.hijriMonths.${month}`)
        : formatMonthName(Number(month)),
  }));

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const yearly = values.calendar !== 'once';
    const fields = {
      name: values.name,
      category: values.category,
      calendar: values.calendar,
      month: yearly ? Number(values.month) : null,
      day: yearly ? Number(values.day) : null,
      date: yearly ? null : values.date || null,
      durationDays: Number(values.durationDays),
      leadDays: Number(values.leadDays),
    };
    const checked = createContentOccasionSchema.safeParse(fields);
    if (!checked.success) {
      for (const issue of checked.error.issues) {
        const field = issue.path[0];
        if (
          field === 'name' ||
          field === 'day' ||
          field === 'date' ||
          field === 'durationDays' ||
          field === 'leadDays'
        ) {
          form.setError(field, { type: 'schema' });
        }
      }
      return;
    }
    if (occasionRuleProblem(checked.data)) {
      form.setError(yearly ? 'day' : 'date', { type: 'rule' });
      return;
    }
    try {
      if (occasion) {
        const { clientId: _client, ...changes } = checked.data;
        await update.mutateAsync({ id: occasion.id, ...changes });
      } else {
        await create.mutateAsync(checked.data);
      }
      toast.add({ title: t('content.settings.occasionSaved'), type: 'success' });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.knownCode === 'INVALID_DATES') {
        form.setError(yearly ? 'day' : 'date', { type: 'server' });
        return;
      }
      setFailure(errorMessage(t, error));
    }
  });

  const select = (
    name: 'category' | 'calendar' | 'month',
    label: string,
    items: { value: string; label: string }[],
  ) => (
    <Field>
      <FieldLabel htmlFor={`${id}-${name}`}>{label}</FieldLabel>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Select
            items={items}
            value={field.value}
            onValueChange={(next) => next && field.onChange(next)}
          >
            <SelectTrigger id={`${id}-${name}`}>
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
        )}
      />
    </Field>
  );

  const number = (
    name: 'day' | 'durationDays' | 'leadDays',
    label: string,
    error: string,
    hint?: string,
  ) => (
    <Field invalid={!!errors[name]}>
      <FieldLabel htmlFor={`${id}-${name}`}>{label}</FieldLabel>
      <Input
        id={`${id}-${name}`}
        type="number"
        dir="ltr"
        className="tabular-nums"
        {...form.register(name)}
      />
      {hint && <FieldDescription>{hint}</FieldDescription>}
      <FieldError
        match={!!errors[name]}
        role={errors[name]?.type === 'server' ? 'alert' : undefined}
      >
        {error}
      </FieldError>
    </Field>
  );

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onClosed={() => {
        setFailure(null);
        form.reset(defaults);
      }}
      submitting={form.formState.isSubmitting}
      title={occasion ? t('content.settings.editOccasionTitle') : t('content.settings.addOccasion')}
      description={t('content.settings.occasionHint')}
      action={t('common.save')}
      failure={failure}
      onSubmit={submit}
    >
      <Field invalid={!!errors.name}>
        <FieldLabel htmlFor={`${id}-name`}>{t('content.settings.occasionName')}</FieldLabel>
        <Input
          id={`${id}-name`}
          maxLength={CONTENT_PLANNING_LIMITS.occasionName}
          {...form.register('name')}
        />
        <FieldError match={!!errors.name}>{t('content.settings.occasionNameError')}</FieldError>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {select(
          'category',
          t('content.settings.category'),
          OCCASION_CATEGORIES.map((category) => ({
            value: category,
            label: t(`content.occasions.categories.${category}`),
          })),
        )}
        {select(
          'calendar',
          t('content.settings.calendar'),
          OCCASION_CALENDARS.map((item) => ({
            value: item,
            label: t(`content.occasions.calendars.${item}`),
          })),
        )}
      </div>
      {calendar === 'once' ? (
        <Field invalid={!!errors.date}>
          <FieldLabel htmlFor={`${id}-date`}>{t('content.settings.date')}</FieldLabel>
          <Input id={`${id}-date`} type="date" dir="ltr" {...form.register('date')} />
          <FieldError match={!!errors.date}>{t('content.settings.dateError')}</FieldError>
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {select('month', t('content.settings.month'), monthItems)}
          {number('day', t('content.settings.day'), t('content.settings.dayError'))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {number(
          'durationDays',
          t('content.settings.duration'),
          t('content.settings.durationError'),
        )}
        {number(
          'leadDays',
          t('content.settings.lead'),
          t('content.settings.leadError'),
          t('content.settings.leadHint'),
        )}
      </div>
    </FormDialog>
  );
}

/**
 * Rule C5: a manager's start for the next occurrence's year (a Hijri date after the moon
 * sighting); "Back to the computed date" removes it.
 */
function ConfirmDateDialog({
  occasion,
  onClose,
}: {
  occasion: ContentOccasion | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dateId = useId();
  const confirm = useConfirmOccasionDate();
  const clear = useClearOccasionDate();
  const [failure, setFailure] = useState<string | null>(null);
  const next = occasion?.occurrences[0];
  const year = next?.year ?? Number(businessDate().slice(0, 4));
  const defaults = { startDate: next?.startDate ?? '' };
  const form = useForm<{ startDate: string }>({ values: defaults });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async ({ startDate }) => {
    if (!occasion) return;
    setFailure(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      form.setError('startDate', { type: 'schema' });
      return;
    }
    try {
      await confirm.mutateAsync({ id: occasion.id, year, startDate });
      toast.add({ title: t('content.settings.dateConfirmed'), type: 'success' });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.knownCode === 'INVALID_DATES') {
        form.setError('startDate', { type: 'server' });
        return;
      }
      setFailure(errorMessage(t, error));
    }
  });

  async function backToComputed() {
    if (!occasion) return;
    setFailure(null);
    try {
      await clear.mutateAsync({ id: occasion.id, year });
      toast.add({ title: t('content.settings.dateCleared'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <FormDialog
      open={occasion !== null}
      onClose={onClose}
      onClosed={() => {
        setFailure(null);
        form.reset(defaults);
      }}
      submitting={form.formState.isSubmitting}
      title={t('content.settings.confirmDateTitle', {
        name: occasion?.name ?? '',
        year: String(year),
      })}
      description={t('content.settings.confirmDateBody')}
      action={t('content.settings.confirmAction')}
      failure={failure}
      onSubmit={submit}
    >
      <Field invalid={!!errors.startDate}>
        <FieldLabel htmlFor={dateId}>{t('content.settings.startDate')}</FieldLabel>
        <Input id={dateId} type="date" dir="ltr" {...form.register('startDate')} />
        <FieldError
          match={!!errors.startDate}
          role={errors.startDate?.type === 'server' ? 'alert' : undefined}
        >
          {t('content.settings.startDateError')}
        </FieldError>
      </Field>
      {next?.confirmed && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          disabled={clear.isPending}
          onClick={() => void backToComputed()}
        >
          {t('content.settings.backToComputed')}
        </Button>
      )}
    </FormDialog>
  );
}

// Default best times (rule C3)

function TimesSection({ manages }: { manages: boolean }) {
  const { t } = useTranslation();
  const settings = useQuery(agencyContentSettingsQuery);
  if (settings.isPending) return <Skeleton className="h-40" />;
  if (settings.isError) {
    return (
      <LoadError message={t('content.settings.loadError')} onRetry={() => settings.refetch()} />
    );
  }
  return <TimesForm initial={settings.data.postingTimes} manages={manages} />;
}

function TimesForm({ initial, manages }: { initial: PostingWindow[]; manages: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const save = useUpdateAgencySettings();
  const [windows, setWindows] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit() {
    setFailure(null);
    const checked = updateContentAgencySettingsSchema.safeParse({ postingTimes: windows });
    if (!checked.success) {
      setInvalid(true);
      return;
    }
    try {
      await save.mutateAsync(checked.data);
      toast.add({ title: t('content.settings.timesSaved'), type: 'success' });
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <PostingTimesEditor
        idPrefix={id}
        value={windows}
        readOnly={!manages}
        onChange={(next) => {
          setWindows(next);
          setInvalid(false);
        }}
      />
      {invalid && (
        <p role="alert" className="text-sm text-destructive-text">
          {t('content.times.error')}
        </p>
      )}
      {failure && <FormAlert>{failure}</FormAlert>}
      {manages && (
        <Button type="submit" className="w-fit" disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('content.settings.saveTimes')}
        </Button>
      )}
    </form>
  );
}
