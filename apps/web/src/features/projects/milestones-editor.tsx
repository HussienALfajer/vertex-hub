import { type CreateMilestoneInput, type Currency, PROJECT_LIMITS } from '@vertex-hub/contracts';
import { Button, Callout, cn, IconButton, Input } from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarX2Icon,
  ListRestartIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useId, useRef } from 'react';
import { flushSync } from 'react-dom';
import { Controller, useFieldArray, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { MoneyInput } from '../../components/money-input';
import { focusAfterRemoval } from '../../lib/focus-after-removal';
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
  const errorId = useId();
  const { fields, append, remove, move, replace } = useFieldArray({
    control: form.control,
    name: 'milestones',
  });
  const list = useRef<HTMLOListElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [milestones, projectDue] = useWatch({
    control: form.control,
    name: ['milestones', 'dueDate'],
  });
  const full = fields.length >= PROJECT_LIMITS.milestones;
  const total = (milestones ?? []).reduce(
    (sum, milestone) => sum + (milestone?.installmentMinor ?? 0),
    0,
  );

  /** Removing a row: the focus goes to the next row's remove button, the previous one, or "add". */
  function removeRow(index: number) {
    flushSync(() => remove(index));
    focusAfterRemoval(list.current, index, addButton.current);
  }

  /**
   * Moving a row keeps the focus on the button that moved it, in its new place; at the top or the
   * bottom that button turns off, so the other direction's takes the focus.
   */
  function moveRow(from: number, to: number) {
    flushSync(() => move(from, to));
    const row = list.current?.children[to];
    const [same, other] = to < from ? ['up', 'down'] : ['down', 'up'];
    const button = (name: string) =>
      row?.querySelector<HTMLButtonElement>(`[data-focus="${name}"]`);
    const target = button(same);
    (target && !target.disabled ? target : button(other))?.focus();
  }

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
        <ol ref={list} className="flex flex-col">
          {fields.map((row, index) => {
            const errors = form.formState.errors.milestones?.[index];
            const due = milestones?.[index]?.dueDate;
            const late = !!due && !!projectDue && due > projectDue;
            const last = index === fields.length - 1;
            const position = formatNumber(index + 1);
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
                  <div className="flex flex-wrap items-center gap-1">
                    <Input
                      aria-label={t('projects.form.milestoneName', { position })}
                      aria-invalid={!!errors?.name || undefined}
                      aria-describedby={errors?.name ? `${errorId}-${index}` : undefined}
                      placeholder={t('projects.form.milestoneNamePlaceholder')}
                      className="basis-full sm:me-2 sm:basis-0 sm:flex-1"
                      {...form.register(`milestones.${index}.name`)}
                    />
                    {/* On a phone the name takes the line and the buttons sit below it. */}
                    <div className="ms-auto flex">
                      <IconButton
                        data-focus="up"
                        disabled={index === 0}
                        label={t('projects.form.moveMilestoneUp', { position })}
                        onClick={() => moveRow(index, index - 1)}
                      >
                        <ArrowUpIcon />
                      </IconButton>
                      <IconButton
                        data-focus="down"
                        disabled={last}
                        label={t('projects.form.moveMilestoneDown', { position })}
                        onClick={() => moveRow(index, index + 1)}
                      >
                        <ArrowDownIcon />
                      </IconButton>
                      <IconButton
                        data-focus="remove"
                        label={t('projects.form.removeMilestone', { position })}
                        onClick={() => removeRow(index)}
                      >
                        <Trash2Icon />
                      </IconButton>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      type="date"
                      dir="ltr"
                      aria-label={t('projects.form.milestoneDue', { position })}
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
                            aria-label={t('projects.form.milestoneInstallment', { position })}
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
                      id={errors?.name ? `${errorId}-${index}` : undefined}
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
          ref={addButton}
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
