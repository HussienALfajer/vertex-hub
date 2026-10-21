import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  businessDate,
  type HrSettings,
  hrSettingsSchema,
  LATENESS_FRACTIONS,
  type LatenessTier,
  type MeResponse,
} from '@vertex-hub/contracts';
import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  PageHeader,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@vertex-hub/ui';
import {
  CalendarOffIcon,
  ClockIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  TrashIcon,
} from 'lucide-react';
import { useId, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { LoadError } from '../../components/load-error';
import { UnsavedChangesGuard } from '../../components/unsaved-changes-guard';
import { can } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { rateInput } from '../../lib/money';
import { ChoiceSelect } from '../quotes/choice-select';
import { checked } from './employee-dialogs';
import { HolidaysTab } from './holidays-tab';
import { hrSettingsQuery, useUpdateHrSettings } from './hr.queries';
import { SchedulesTab } from './schedules-tab';

/** HR settings are kept by `hr.manage` (spec F17, screen "HR settings"). */
export const managesHr = (me: MeResponse) => can(me, 'hr.manage');

const SETTINGS_TABS = ['rules', 'schedules', 'holidays'] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number];

export interface HrSettingsSearch {
  /** Unset means the first tab. */
  tab?: SettingsTab;
  /** The holidays' year; unset means this year. */
  year?: number;
}

export function parseHrSettingsSearch(search: Record<string, unknown>): HrSettingsSearch {
  const year = Number(search.year);
  return {
    tab: SETTINGS_TABS.find((tab) => tab === search.tab),
    year: Number.isInteger(year) && year >= 2000 && year <= 2999 ? year : undefined,
  };
}

/**
 * HR settings `/hr/settings` (spec F17): the attendance and leave rules, the work schedules and
 * the public holidays. The attendance start date and the entrance screens arrive with Part C.
 */
export function HrSettingsPage({ search }: { search: HrSettingsSearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/hr/settings' });
  const tab = search.tab ?? 'rules';

  return (
    <>
      <PageHeader title={t('hr.settings.title')} description={t('hr.settings.subtitle')} />
      <Tabs
        value={tab}
        onValueChange={(next: SettingsTab) =>
          navigate({
            search: (previous) => ({ ...previous, tab: next === 'rules' ? undefined : next }),
            replace: true,
          })
        }
      >
        <TabsList aria-label={t('hr.settings.title')}>
          <TabsTrigger value="rules">
            <SlidersHorizontalIcon />
            {t('hr.settings.tabs.rules')}
          </TabsTrigger>
          <TabsTrigger value="schedules">
            <ClockIcon />
            {t('hr.settings.tabs.schedules')}
          </TabsTrigger>
          <TabsTrigger value="holidays">
            <CalendarOffIcon />
            {t('hr.settings.tabs.holidays')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="rules">
          <RulesTab />
        </TabsContent>
        <TabsContent value="schedules">
          <SchedulesTab />
        </TabsContent>
        <TabsContent value="holidays">
          <HolidaysTab
            year={search.year ?? Number(businessDate().slice(0, 4))}
            onYearChange={(year) =>
              navigate({ search: (previous) => ({ ...previous, year }), replace: true })
            }
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

function RulesTab() {
  const { t } = useTranslation();
  const settings = useQuery(hrSettingsQuery);
  if (settings.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-80" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (settings.isError) {
    return <LoadError message={t('hr.settings.loadError')} onRetry={() => settings.refetch()} />;
  }
  return <RulesForm settings={settings.data} />;
}

/** The settings typed as text, so Arabic digits and an empty field can be read and refused. */
const NUMBER_FIELDS = [
  'graceMinutes',
  'overtimeMinMinutes',
  'checkInReminderMinutes',
  'overtimeMinutesPerLeaveDay',
  'defaultAnnualLeaveDays',
  'carryOverMaxDays',
  'sickDaysPerYear',
  'sickCertificateAfterDays',
  'sickRequestWithinWorkDays',
  'emergencyDaysPerYear',
  'permissionMaxMinutes',
  'permissionsPerMonth',
  'annualNoticeWorkDays',
  'remoteNoticeWorkDays',
] as const satisfies readonly (keyof HrSettings)[];

type NumberField = (typeof NUMBER_FIELDS)[number];

type RulesValues = Record<NumberField, string> & {
  firstLatenessWarning: boolean;
  /** The last tier's limit is ignored: it is "more" (null). */
  latenessTiers: { upToMinutes: string; fraction: string }[];
};

const valuesOf = (settings: HrSettings): RulesValues => ({
  ...(Object.fromEntries(NUMBER_FIELDS.map((field) => [field, String(settings[field])])) as Record<
    NumberField,
    string
  >),
  firstLatenessWarning: settings.firstLatenessWarning,
  latenessTiers: settings.latenessTiers.map((tier) => ({
    upToMinutes: tier.upToMinutes === null ? '' : String(tier.upToMinutes),
    fraction: String(tier.fraction),
  })),
});

/** The fractions' translation keys: a key cannot hold the decimal point. */
const FRACTION_KEYS = {
  0.25: 'quarter',
  0.5: 'half',
  0.75: 'threeQuarters',
  1: 'full',
} as const satisfies Record<LatenessTier['fraction'], string>;

/** A number as typed, or NaN for an empty field, so the schema refuses it. */
const typedNumber = (text: string) => (text.trim() ? Number(rateInput(text)) : Number.NaN);

/** Rule C9's tiers, rule C17's warning and the leave policy (rules B4–B13), saved as a whole. */
function RulesForm({ settings }: { settings: HrSettings }) {
  const { t } = useTranslation();
  const ids = { warning: useId(), tier: useId() };
  const update = useUpdateHrSettings();
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<RulesValues>({
    // A refetch (another manager saved) keeps what this user already changed.
    resetOptions: { keepDirtyValues: true },
    values: valuesOf(settings),
  });
  const tiers = useFieldArray({ control: form.control, name: 'latenessTiers' });
  const { errors, isDirty, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const input = checked(
      form,
      hrSettingsSchema.safeParse({
        // Rule C1: the start date is kept as stored; its field arrives with the attendance screens.
        attendanceStartsOn: settings.attendanceStartsOn,
        ...Object.fromEntries(NUMBER_FIELDS.map((field) => [field, typedNumber(values[field])])),
        firstLatenessWarning: values.firstLatenessWarning,
        latenessTiers: values.latenessTiers.map((tier, index) => ({
          upToMinutes:
            index === values.latenessTiers.length - 1 ? null : typedNumber(tier.upToMinutes),
          fraction: Number(tier.fraction),
        })),
      }),
    );
    if (!input) return;
    try {
      form.reset(valuesOf(await update.mutateAsync(input)), { keepDirtyValues: false });
      toast.add({ title: t('hr.settings.saved'), type: 'success' });
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  const field = (name: NumberField) => (
    <Field invalid={!!errors[name]}>
      <FieldLabel>{t(`hr.settings.fields.${name}`)}</FieldLabel>
      <Input dir="ltr" inputMode="decimal" autoComplete="off" {...form.register(name)} />
      <FieldDescription>{t(`hr.settings.hints.${name}`)}</FieldDescription>
      <FieldError match={!!errors[name]}>{t('hr.settings.errors.number')}</FieldError>
    </Field>
  );

  const fractionItems = LATENESS_FRACTIONS.map((fraction) => ({
    value: String(fraction),
    label: t(`hr.settings.fractions.${FRACTION_KEYS[fraction]}`),
  }));
  const tierError = (index: number) => !!errors.latenessTiers?.[index]?.upToMinutes;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        // The list's own error is not a field's: the submit would keep it and never run.
        form.clearErrors('latenessTiers');
        return submit(event);
      }}
      noValidate
    >
      <FormSection title={t('hr.settings.attendance')} hint={t('hr.settings.attendanceHint')}>
        <div className="grid gap-5 sm:grid-cols-2">
          {field('graceMinutes')}
          {field('checkInReminderMinutes')}
        </div>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-medium">{t('hr.settings.tiers')}</legend>
          <p className="text-sm text-muted-foreground">{t('hr.settings.tiersHint')}</p>
          <ol className="flex flex-col gap-3">
            {tiers.fields.map((tier, index) => {
              const last = index === tiers.fields.length - 1;
              return (
                <li key={tier.id} className="flex flex-wrap items-start gap-3" data-tier={index}>
                  <Field invalid={tierError(index)} className="w-40">
                    <FieldLabel>{t('hr.settings.tierUpTo')}</FieldLabel>
                    {last ? (
                      <Input value={t('hr.settings.tierMore')} readOnly disabled />
                    ) : (
                      <Input
                        dir="ltr"
                        inputMode="numeric"
                        autoComplete="off"
                        {...form.register(`latenessTiers.${index}.upToMinutes`)}
                      />
                    )}
                  </Field>
                  <Controller
                    control={form.control}
                    name={`latenessTiers.${index}.fraction`}
                    render={({ field: fraction }) => (
                      <Field className="w-44">
                        <FieldLabel id={`${ids.tier}-${index}`} render={<span />}>
                          {t('hr.settings.tierFraction')}
                        </FieldLabel>
                        <ChoiceSelect
                          labelledBy={`${ids.tier}-${index}`}
                          items={fractionItems}
                          value={fraction.value}
                          onChange={fraction.onChange}
                        />
                      </Field>
                    )}
                  />
                  {tiers.fields.length > 1 && (
                    <IconButton
                      label={t('hr.settings.removeTier')}
                      className="mt-7"
                      onClick={() => tiers.remove(index)}
                    >
                      <TrashIcon />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ol>
          {errors.latenessTiers && (
            <p role="alert" className="text-sm text-destructive-text">
              {t('hr.settings.errors.tiers')}
            </p>
          )}
          {tiers.fields.length < 6 && (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  // A new tier goes before the open one, which stays last.
                  tiers.insert(tiers.fields.length - 1, { upToMinutes: '', fraction: '0.25' })
                }
              >
                <PlusIcon />
                {t('hr.settings.addTier')}
              </Button>
            </div>
          )}
        </fieldset>
        <Controller
          control={form.control}
          name="firstLatenessWarning"
          render={({ field: warning }) => (
            <Field>
              <div className="flex items-center justify-between gap-4">
                <FieldLabel htmlFor={ids.warning}>
                  {t('hr.settings.fields.firstLatenessWarning')}
                </FieldLabel>
                <Switch
                  id={ids.warning}
                  checked={warning.value}
                  onCheckedChange={warning.onChange}
                />
              </div>
              <FieldDescription>{t('hr.settings.hints.firstLatenessWarning')}</FieldDescription>
            </Field>
          )}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          {field('overtimeMinMinutes')}
          {field('overtimeMinutesPerLeaveDay')}
        </div>
      </FormSection>

      <FormSection title={t('hr.settings.leave')} hint={t('hr.settings.leaveHint')}>
        <div className="grid gap-5 sm:grid-cols-2">
          {field('defaultAnnualLeaveDays')}
          {field('carryOverMaxDays')}
          {field('annualNoticeWorkDays')}
          {field('remoteNoticeWorkDays')}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {field('sickDaysPerYear')}
          {field('sickCertificateAfterDays')}
          {field('sickRequestWithinWorkDays')}
          {field('emergencyDaysPerYear')}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {field('permissionMaxMinutes')}
          {field('permissionsPerMonth')}
        </div>
      </FormSection>

      {failure && <FormAlert>{failure}</FormAlert>}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {isDirty && (
          <p className="me-auto text-sm text-muted-foreground">{t('quotes.builder.unsaved')}</p>
        )}
        {/* Focusable while disabled, so saving does not drop the focus. */}
        <Button type="submit" disabled={!isDirty || isSubmitting} focusableWhenDisabled>
          {isSubmitting ? t('common.saving') : t('hr.settings.save')}
        </Button>
      </div>
      <UnsavedChangesGuard dirty={isDirty} />
    </form>
  );
}
