import { useQuery } from '@tanstack/react-query';
import {
  addDays,
  businessDate,
  type ClientContentSettings,
  type ContentPillar,
  OCCASION_CATEGORIES,
  type OccasionCategory,
  occasionApplies,
  type PostingWindow,
  updateClientContentSettingsSchema,
} from '@vertex-hub/contracts';
import {
  Button,
  Callout,
  ChartDot,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
  Switch,
  toast,
} from '@vertex-hub/ui';
import { useId, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';
import { formatCalendarDate, formatNumber } from '../../lib/format';
import {
  clientContentSettingsQuery,
  contentOccasionsQuery,
  contentPillarsQuery,
  useUpdateClientSettings,
} from './content.queries';
import { PostingTimesEditor } from './posting-times-editor';

/*
 * Spec F08B screen 3, "Settings": a client's pillar targets (rule C1), rhythm (C7), best times
 * (C3), occasion categories and exclusions (C4) and X long posts, for edit-scope users.
 */

/** How far ahead the occasions to exclude are listed. */
const OCCASION_DAYS = 365;

interface SettingsValues {
  /** Percent per pillar id, as typed; empty means no target. */
  targets: Record<string, string>;
  maxGapDays: string;
  postingTimes: PostingWindow[];
  occasionCategories: OccasionCategory[];
  excludedOccasionIds: string[];
  xLongPosts: boolean;
}

export function ClientSettingsDialog({
  clientId,
  clientName,
  open,
  onClose,
}: {
  clientId: string;
  clientName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('content.clientSettings.title', { name: clientName })}</DialogTitle>
          <DialogDescription>{t('content.clientSettings.hint')}</DialogDescription>
        </DialogHeader>
        {open && <SettingsLoader clientId={clientId} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function SettingsLoader({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const settings = useQuery(clientContentSettingsQuery(clientId));
  const pillars = useQuery(contentPillarsQuery);
  if (settings.isPending || pillars.isPending) return <Skeleton className="h-96" />;
  if (settings.isError || pillars.isError) {
    return (
      <LoadError
        message={t('content.clientSettings.loadError')}
        onRetry={() => {
          void settings.refetch();
          void pillars.refetch();
        }}
      />
    );
  }
  return (
    <SettingsForm
      clientId={clientId}
      settings={settings.data}
      pillars={pillars.data.items}
      onClose={onClose}
    />
  );
}

function SettingsForm({
  clientId,
  settings,
  pillars,
  onClose,
}: {
  clientId: string;
  settings: ClientContentSettings;
  pillars: ContentPillar[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const save = useUpdateClientSettings(clientId);
  const [failure, setFailure] = useState<string | null>(null);
  const live = pillars.filter((pillar) => !pillar.archived);
  // Edge case 13: a target on an archived pillar is ignored; the manager redistributes it.
  const stale = settings.pillarTargets.filter(
    (target) => !live.some((pillar) => pillar.id === target.pillarId),
  );
  const form = useForm<SettingsValues>({
    defaultValues: {
      targets: Object.fromEntries(
        live.map((pillar) => [
          pillar.id,
          String(
            settings.pillarTargets.find((target) => target.pillarId === pillar.id)?.percent ?? '',
          ),
        ]),
      ),
      maxGapDays: String(settings.maxGapDays),
      // The client's own windows only: the agency's stay where the client lists nothing.
      postingTimes: settings.postingTimes,
      occasionCategories: settings.occasionCategories,
      excludedOccasionIds: settings.excludedOccasionIds,
      xLongPosts: settings.xLongPosts,
    },
  });
  const { errors } = form.formState;
  const [targets, categories] = useWatch({
    control: form.control,
    name: ['targets', 'occasionCategories'],
  });
  const targetSum = Object.values(targets).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const today = businessDate();
  const occasions = useQuery(
    contentOccasionsQuery({ from: today, to: addDays(today, OCCASION_DAYS - 1) }),
  );
  // The occasions the categories bring, or the client's own: those it may exclude.
  const excludable = (occasions.data?.items ?? []).filter((occasion) =>
    occasionApplies(
      { id: occasion.id, clientId: occasion.client?.id ?? null, category: occasion.category },
      { id: clientId, occasionCategories: categories, excludedOccasionIds: [] },
    ),
  );

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const pillarTargets = Object.entries(values.targets)
      .filter(([, percent]) => percent.trim() !== '' && Number(percent) !== 0)
      .map(([pillarId, percent]) => ({ pillarId, percent: Number(percent) }));
    const sum = pillarTargets.reduce((total, target) => total + target.percent, 0);
    if (pillarTargets.length > 0 && sum !== 100) {
      form.setError('root.targets', { type: 'sum' });
      return;
    }
    const checked = updateClientContentSettingsSchema.safeParse({
      postingTimes: values.postingTimes,
      pillarTargets,
      maxGapDays: Number(values.maxGapDays),
      occasionCategories: values.occasionCategories,
      excludedOccasionIds: values.excludedOccasionIds,
      xLongPosts: values.xLongPosts,
    });
    if (!checked.success) {
      for (const issue of checked.error.issues) {
        const field = issue.path[0];
        if (field === 'pillarTargets') form.setError('root.targets', { type: 'schema' });
        if (field === 'maxGapDays' || field === 'postingTimes') {
          form.setError(field, { type: 'schema' });
        }
      }
      return;
    }
    try {
      await save.mutateAsync(checked.data);
      toast.add({ title: t('content.clientSettings.saved'), type: 'success' });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.knownCode === 'INVALID_TARGETS') {
        form.setError('root.targets', { type: 'server' });
        return;
      }
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <form className="grid gap-6" noValidate onSubmit={submit}>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-base font-bold">{t('content.clientSettings.pillars')}</legend>
        <p className="text-sm text-muted-foreground">{t('content.clientSettings.pillarsHint')}</p>
        {stale.length > 0 && (
          <Callout tone="warning" title={t('content.clientSettings.staleTitle')}>
            {t('content.clientSettings.staleBody')}
          </Callout>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {live.map((pillar) => (
            <Field
              key={pillar.id}
              invalid={!!errors.root?.targets}
              className="flex-row items-center gap-2"
            >
              <FieldLabel
                htmlFor={`${id}-target-${pillar.id}`}
                className="flex flex-1 items-center gap-2"
              >
                <ChartDot color={pillar.color} />
                {pillar.name}
              </FieldLabel>
              <Input
                id={`${id}-target-${pillar.id}`}
                dir="ltr"
                inputMode="numeric"
                className="w-20 tabular-nums"
                {...form.register(`targets.${pillar.id}`)}
              />
              <span aria-hidden="true" className="text-sm text-muted-foreground">
                %
              </span>
            </Field>
          ))}
        </div>
        <p
          className="text-sm tabular-nums text-muted-foreground"
          aria-live="polite"
          data-target-sum={targetSum}
        >
          {t('content.clientSettings.sum', { n: formatNumber(targetSum) })}
        </p>
        {errors.root?.targets && (
          <p role="alert" className="text-sm text-destructive-text">
            {t('content.clientSettings.targetsError')}
          </p>
        )}
      </fieldset>

      <Field invalid={!!errors.maxGapDays} className="max-w-xs">
        <FieldLabel htmlFor={`${id}-gap`}>{t('content.clientSettings.rhythm')}</FieldLabel>
        <Input
          id={`${id}-gap`}
          type="number"
          dir="ltr"
          min={1}
          max={14}
          className="w-24 tabular-nums"
          {...form.register('maxGapDays')}
        />
        <FieldDescription>{t('content.clientSettings.rhythmHint')}</FieldDescription>
        <FieldError match={!!errors.maxGapDays}>
          {t('content.clientSettings.rhythmError')}
        </FieldError>
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-base font-bold">{t('content.clientSettings.times')}</legend>
        <p className="text-sm text-muted-foreground">{t('content.clientSettings.timesHint')}</p>
        <Controller
          control={form.control}
          name="postingTimes"
          render={({ field }) => (
            <PostingTimesEditor
              idPrefix={`${id}-times`}
              value={field.value}
              onChange={(next) => {
                field.onChange(next);
                form.clearErrors('postingTimes');
              }}
            />
          )}
        />
        {errors.postingTimes && (
          <p role="alert" className="text-sm text-destructive-text">
            {t('content.times.error')}
          </p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-base font-bold">
          {t('content.clientSettings.occasions')}
        </legend>
        <p className="text-sm text-muted-foreground">{t('content.clientSettings.occasionsHint')}</p>
        <Controller
          control={form.control}
          name="occasionCategories"
          render={({ field }) => (
            <div className="grid gap-2 sm:grid-cols-3">
              {OCCASION_CATEGORIES.filter((category) => category !== 'general').map((category) => (
                <label
                  key={category}
                  htmlFor={`${id}-category-${category}`}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <Checkbox
                    id={`${id}-category-${category}`}
                    checked={field.value.includes(category)}
                    onCheckedChange={(checked) =>
                      field.onChange(
                        checked
                          ? [...field.value, category]
                          : field.value.filter((item) => item !== category),
                      )
                    }
                  />
                  {t(`content.occasions.categories.${category}`)}
                </label>
              ))}
            </div>
          )}
        />
        <h3 className="text-sm font-medium">{t('content.clientSettings.exclusions')}</h3>
        {occasions.isPending ? (
          <Skeleton className="h-16" />
        ) : excludable.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('content.clientSettings.noOccasions')}</p>
        ) : (
          <Controller
            control={form.control}
            name="excludedOccasionIds"
            render={({ field }) => (
              <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                {excludable.map((occasion) => {
                  const start = occasion.occurrences[0]?.startDate;
                  const applies = !field.value.includes(occasion.id);
                  return (
                    <li key={occasion.id} className="flex items-center gap-2 text-sm">
                      <Switch
                        id={`${id}-occasion-${occasion.id}`}
                        checked={applies}
                        onCheckedChange={(checked) =>
                          field.onChange(
                            checked
                              ? field.value.filter((item) => item !== occasion.id)
                              : [...field.value, occasion.id],
                          )
                        }
                      />
                      <label htmlFor={`${id}-occasion-${occasion.id}`} className="flex-1">
                        {occasion.name}
                      </label>
                      {start && (
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {formatCalendarDate(start)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          />
        )}
      </fieldset>

      <Controller
        control={form.control}
        name="xLongPosts"
        render={({ field }) => (
          <div className="flex items-start gap-3">
            <Switch id={`${id}-x`} checked={field.value} onCheckedChange={field.onChange} />
            <label htmlFor={`${id}-x`} className="flex flex-col gap-0.5 text-sm font-medium">
              {t('content.clientSettings.xLongPosts')}
              <span className="font-normal text-muted-foreground">
                {t('content.clientSettings.xLongPostsHint')}
              </span>
            </label>
          </div>
        )}
      />

      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('common.saving') : t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
