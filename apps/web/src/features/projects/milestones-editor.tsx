import { type CreateMilestoneInput, type Currency, PROJECT_LIMITS } from '@vertex-hub/contracts';
import { Button, Callout, cn, Input } from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarX2Icon,
  ListRestartIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { Controller, useFieldArray, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { MoneyInput } from '../../components/money-input';
import { formatNumber } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import type { ProjectFormMethods } from './project-form';

/** The suggested set the form offers (spec F05, `project_milestones`), named in the UI language. */
const SUGGESTED_MILESTONES = ['discovery', 'design', 'build', 'test', 'delivery'] as const;

export function suggestedMilestones(t: TFunction): CreateMilestoneInput[] {
  return SUGGESTED_MILESTONES.map((key) => ({
    name: t(`projects.suggested.${key}`),
    dueDate: null,
    installmentMinor: null,
  }));
}

/**
 * The project's plan before it exists: an ordered list of milestones, each with an optional due
 * date and, with money access, an installment. Order is the list order.
 */
export function MilestonesEditor({
  form,
  money,
}: {
  form: ProjectFormMethods;
  /** The currency when the user has money access to the chosen client. */
  money: Currency | null;
}) {
  const { t } = useTranslation();
  const { fields, append, remove, move, replace } = useFieldArray({
    control: form.control,
    name: 'milestones',
  });
  const [milestones, projectDue] = useWatch({
    control: form.control,
    name: ['milestones', 'dueDate'],
  });
  const full = fields.length >= PROJECT_LIMITS.milestones;
  const total = (milestones ?? []).reduce(
    (sum, milestone) => sum + (milestone?.installmentMinor ?? 0),
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      {fields.length === 0 ? (
        <Callout
          icon={<ListRestartIcon />}
          title={t('projects.form.noMilestones')}
          description={t('projects.form.noMilestonesHint')}
          action={
            <Button variant="outline" size="sm" onClick={() => replace(suggestedMilestones(t))}>
              {t('projects.form.useSuggested')}
            </Button>
          }
        />
      ) : (
        <ol className="flex flex-col">
          {fields.map((row, index) => {
            const errors = form.formState.errors.milestones?.[index];
            const due = milestones?.[index]?.dueDate;
            const late = !!due && !!projectDue && due > projectDue;
            const last = index === fields.length - 1;
            return (
              <li key={row.id} className="relative flex gap-4 pb-4 last:pb-0">
                {/* The path between steps. */}
                {!last && (
                  <span
                    aria-hidden="true"
                    className="absolute start-4 top-9 bottom-0 w-px -translate-x-1/2 bg-border rtl:translate-x-1/2"
                  />
                )}
                <span
                  aria-hidden="true"
                  className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-sm font-medium tabular-nums"
                >
                  {formatNumber(index + 1)}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg border border-border p-3">
                  <div className="flex items-center gap-1">
                    <Input
                      aria-label={t('projects.form.milestoneName', { position: index + 1 })}
                      aria-invalid={!!errors?.name || undefined}
                      placeholder={t('projects.form.milestoneNamePlaceholder')}
                      className="me-2 flex-1"
                      {...form.register(`milestones.${index}.name`)}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === 0}
                      aria-label={t('projects.milestones.moveUp')}
                      onClick={() => move(index, index - 1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={last}
                      aria-label={t('projects.milestones.moveDown')}
                      onClick={() => move(index, index + 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('projects.form.removeMilestone')}
                      onClick={() => remove(index)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      type="date"
                      aria-label={t('projects.form.milestoneDue', { position: index + 1 })}
                      {...form.register(`milestones.${index}.dueDate`, {
                        setValueAs: (value: string | null) => value || null,
                      })}
                    />
                    {money && (
                      <Controller
                        control={form.control}
                        name={`milestones.${index}.installmentMinor`}
                        render={({ field }) => (
                          <MoneyInput
                            aria-label={t('projects.form.milestoneInstallment', {
                              position: index + 1,
                            })}
                            placeholder={t('projects.form.installment')}
                            currency={money}
                            value={field.value}
                            onValueChange={field.onChange}
                            onBlur={field.onBlur}
                          />
                        )}
                      />
                    )}
                  </div>
                  {(errors?.name || late) && (
                    <p
                      className={cn(
                        'flex items-center gap-1.5 text-sm',
                        errors?.name ? 'text-destructive-text' : 'text-status-warning-foreground',
                      )}
                    >
                      {!errors?.name && <CalendarX2Icon aria-hidden="true" className="size-4" />}
                      {errors?.name
                        ? t('projects.form.errors.milestoneName')
                        : t('projects.milestones.afterProjectDue')}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={full}
          onClick={() => append({ name: '', dueDate: null, installmentMinor: null })}
        >
          <PlusIcon />
          {t('projects.milestones.add')}
        </Button>
        {money && fields.length > 0 && (
          <p className="text-sm">
            <span className="text-muted-foreground">{t('projects.milestones.total')} </span>
            <span className="font-bold tabular-nums">{formatMoney(total, money)}</span>
          </p>
        )}
      </div>
      {full && (
        <p className="text-sm text-muted-foreground">
          {t('projects.form.milestonesLimit', { max: formatNumber(PROJECT_LIMITS.milestones) })}
        </p>
      )}
    </div>
  );
}
