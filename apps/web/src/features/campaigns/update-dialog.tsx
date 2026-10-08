import {
  businessDate,
  type CampaignDetail,
  type CampaignUpdate,
  campaignUpdateInputSchema,
  costPerResult,
} from '@vertex-hub/contracts';
import {
  Callout,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { TriangleAlertIcon } from 'lucide-react';
import { type ComponentProps, useId, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { MoneyInput } from '../../components/money-input';
import { errorMessage } from '../../lib/errors';
import { useFocusFirstError } from '../../lib/focus-first-invalid';
import { isolateLtr } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { Money } from '../quotes/quote-badges';
import { FormDialog } from '../quotes/quote-dialogs';
import { CostPerResult } from './campaign-badges';
import { useAddCampaignUpdate, useEditCampaignUpdate } from './campaigns.queries';
import { count } from './update-count';
import { defaultPeriod } from './update-period';

interface UpdateValues {
  periodStart: string;
  periodEnd: string;
  spendMinor: number | null;
  reach: string;
  clicks: string;
  results: string;
  note: string;
}

/**
 * Spec screen 3, "Add update": a period with its spend and results. Before saving it shows the
 * cost per result and warns when the campaign goes over its budget or the wallet below zero; the
 * save is never refused for that (rule 13).
 */
export function UpdateDialog({
  campaign,
  update,
  open,
  onClose,
  finalFocus,
}: {
  campaign: CampaignDetail;
  /** The update to edit; a new one otherwise. */
  update?: CampaignUpdate;
  open: boolean;
  onClose: () => void;
  /** Where the focus goes when it closes: the button that opened it, or what replaced it. */
  finalFocus: ComponentProps<typeof FormDialog>['finalFocus'];
}) {
  const { t } = useTranslation();
  const spendId = useId();
  const add = useAddCampaignUpdate(campaign.id);
  const edit = useEditCampaignUpdate();
  const today = businessDate();
  const defaults: UpdateValues = update
    ? {
        periodStart: update.periodStart,
        periodEnd: update.periodEnd,
        spendMinor: update.spendMinor,
        reach: String(update.reach),
        clicks: String(update.clicks),
        results: String(update.results),
        note: update.note,
      }
    : {
        ...defaultPeriod(today),
        spendMinor: null,
        reach: '',
        clicks: '',
        results: '',
        note: '',
      };
  // The first invalid field takes the focus, the spend's money field included.
  const form = useForm<UpdateValues>({ values: defaults, shouldFocusError: false });
  const fields = useRef<HTMLDivElement>(null);
  useFocusFirstError(form.formState.submitCount, fields);
  const [failure, setFailure] = useState<string | null>(null);
  const { errors } = form.formState;
  const [spend, results] = form.watch(['spendMinor', 'results']);

  // What the save changes: this update's spend replaces its earlier one.
  const change = (spend ?? 0) - (update?.spendMinor ?? 0);
  const spendAfter = campaign.totals.spendMinor + change;
  const overBudget = spend !== null && spendAfter > campaign.budgetMinor;
  const walletAfter =
    campaign.walletBalanceMinor === null ? null : campaign.walletBalanceMinor - change;
  const walletNegative = spend !== null && walletAfter !== null && walletAfter < 0;
  const resultCount = count(results);
  const cost =
    spend !== null && Number.isInteger(resultCount) ? costPerResult(spend, resultCount) : undefined;
  const resultsLabel = t(`campaigns.results.${campaign.objective}`);

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const checked = campaignUpdateInputSchema.safeParse({
      periodStart: values.periodStart,
      periodEnd: values.periodEnd,
      spendMinor: values.spendMinor,
      reach: count(values.reach),
      clicks: count(values.clicks),
      results: count(values.results),
      note: values.note,
    });
    if (!checked.success) {
      for (const issue of checked.error.issues) {
        form.setError(issue.path.join('.') as keyof UpdateValues, { type: 'schema' });
      }
      return;
    }
    if (checked.data.periodEnd < checked.data.periodStart) {
      form.setError('periodEnd', { type: 'validate' });
      return;
    }
    try {
      if (update) {
        await edit.mutateAsync({ updateId: update.id, ...checked.data });
        toast.add({ title: t('campaigns.updates.saved'), type: 'success' });
      } else {
        await add.mutateAsync(checked.data);
        toast.add({ title: t('campaigns.updates.added'), type: 'success' });
      }
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  const metric = (name: 'reach' | 'clicks' | 'results', label: string, hint?: string) => (
    <Field invalid={!!errors[name]}>
      <FieldLabel>{label}</FieldLabel>
      <Input
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        className="tabular-nums"
        {...form.register(name)}
      />
      {hint && <FieldDescription>{hint}</FieldDescription>}
      <FieldError match={!!errors[name]}>{t('campaigns.updates.errors.metric')}</FieldError>
    </Field>
  );

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      // Reset once it has faded out, so nothing typed is kept for the next opening.
      onClosed={() => {
        setFailure(null);
        form.reset(defaults);
      }}
      finalFocus={finalFocus}
      submitting={form.formState.isSubmitting}
      title={update ? t('campaigns.updates.editTitle') : t('campaigns.updates.addTitle')}
      description={t('campaigns.updates.hint')}
      action={update ? t('common.save') : t('campaigns.updates.add')}
      failure={failure}
      onSubmit={submit}
    >
      <div ref={fields} className="contents">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field invalid={!!errors.periodStart}>
            <FieldLabel>{t('campaigns.updates.periodStart')}</FieldLabel>
            <Input
              type="date"
              dir="ltr"
              max={today}
              {...form.register('periodStart', { required: true })}
            />
            <FieldError match={!!errors.periodStart}>
              {t('campaigns.updates.errors.period')}
            </FieldError>
          </Field>
          <Field invalid={!!errors.periodEnd}>
            <FieldLabel>{t('campaigns.updates.periodEnd')}</FieldLabel>
            <Input
              type="date"
              dir="ltr"
              max={today}
              {...form.register('periodEnd', { validate: (day) => !!day && day <= today })}
            />
            <FieldError match={!!errors.periodEnd}>
              {t('campaigns.updates.errors.period')}
            </FieldError>
          </Field>
        </div>
        <p className="-mt-3 text-sm text-muted-foreground">{t('campaigns.updates.periodHint')}</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="spendMinor"
            rules={{ validate: (minor) => minor !== null }}
            render={({ field }) => (
              <Field invalid={!!errors.spendMinor}>
                <FieldLabel htmlFor={spendId}>{t('campaigns.updates.spend')}</FieldLabel>
                <MoneyInput
                  id={spendId}
                  currency="USD"
                  value={field.value}
                  onValueChange={field.onChange}
                />
                <FieldError match={!!errors.spendMinor}>
                  {t('campaigns.updates.errors.spend')}
                </FieldError>
              </Field>
            )}
          />
          {metric('results', resultsLabel, t('campaigns.updates.resultsHint'))}
          {metric('reach', t('campaigns.updates.reach'), t('campaigns.updates.reachHint'))}
          {metric('clicks', t('campaigns.updates.clicks'))}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border border-border p-3 text-sm">
          <dt className="text-muted-foreground">{t('campaigns.columns.costPerResult')}</dt>
          <dd className="font-bold">
            <CostPerResult minor={cost ?? null} />
          </dd>
          <dt className="text-muted-foreground">{t('campaigns.updates.spendAfter')}</dt>
          <dd>
            {t('campaigns.updates.ofBudget', {
              spend: isolateLtr(formatMoney(spendAfter, 'USD')),
              budget: isolateLtr(formatMoney(campaign.budgetMinor, 'USD')),
            })}
          </dd>
          {walletAfter !== null && (
            <>
              <dt className="text-muted-foreground">{t('campaigns.updates.walletAfter')}</dt>
              <dd>
                <Money
                  minor={walletAfter}
                  currency="USD"
                  className={walletAfter < 0 ? 'text-destructive-text' : undefined}
                />
              </dd>
            </>
          )}
        </dl>
        {overBudget && (
          <Callout
            tone="warning"
            icon={<TriangleAlertIcon />}
            title={t('campaigns.updates.overBudgetTitle')}
            description={t('campaigns.updates.overBudgetBody')}
          />
        )}
        {walletNegative && (
          <Callout
            tone="warning"
            icon={<TriangleAlertIcon />}
            title={t('campaigns.updates.walletNegativeTitle')}
            description={t('campaigns.updates.walletNegativeBody')}
          />
        )}
        <Field invalid={!!errors.note}>
          <FieldLabel>{t('campaigns.updates.note')}</FieldLabel>
          <Textarea rows={2} {...form.register('note')} />
          <FieldError match={!!errors.note}>{t('campaigns.updates.errors.note')}</FieldError>
        </Field>
      </div>
    </FormDialog>
  );
}
