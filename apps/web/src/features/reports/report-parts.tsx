import { Link } from '@tanstack/react-router';
import {
  businessDate,
  isValidReportPeriod,
  REPORT_PERIOD_MAX_DAYS,
  type ReportPeriod,
  reportMonths,
} from '@vertex-hub/contracts';
import { Button, Field, FieldError, FieldLabel, Input } from '@vertex-hub/ui';
import { ArrowRightIcon, FileSpreadsheetIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMonth, formatNumber } from '../../lib/format';
import { dayParam } from '../../lib/search-params';
import { recentMonths } from '../files/library-search';
import { ChoiceSelect } from '../quotes/choice-select';

/** A report period in the URL; unset means the API's default, this month to today. */
export interface PeriodSearch {
  from?: string;
  to?: string;
}

export function parsePeriodSearch(search: Record<string, unknown>): PeriodSearch {
  const from = dayParam(search.from);
  const to = dayParam(search.to);
  // Half a period is no period: both ends or neither.
  return from && to ? { from, to } : {};
}

/**
 * The period the screen shows and the query the API gets. An invalid custom period (rules 8 and
 * 11: `to` before `from`, or over 366 days) is never sent: the API would refuse it.
 */
export function usePeriod(search: PeriodSearch): {
  period: ReportPeriod;
  query: PeriodSearch;
  valid: boolean;
} {
  const { thisMonth } = reportMonths(businessDate());
  if (!search.from || !search.to) return { period: thisMonth, query: {}, valid: true };
  const period = { from: search.from, to: search.to };
  return { period, query: period, valid: isValidReportPeriod(period) };
}

const PRESETS = ['thisMonth', 'lastMonth', 'custom'] as const;

type Preset = (typeof PRESETS)[number];

function presetOf(search: PeriodSearch): Preset {
  if (!search.from || !search.to) return 'thisMonth';
  const { lastMonth } = reportMonths(businessDate());
  return search.from === lastMonth.from && search.to === lastMonth.to ? 'lastMonth' : 'custom';
}

/** Screens 3 and 4: this month, last month or a custom period of at most 366 days. */
export function PeriodPicker({
  search,
  onChange,
}: {
  search: PeriodSearch;
  onChange: (next: PeriodSearch) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [custom, setCustom] = useState(() => presetOf(search) === 'custom');
  const preset = custom ? 'custom' : presetOf(search);
  const { period, valid } = usePeriod(search);

  function pick(next: Preset) {
    const { lastMonth } = reportMonths(businessDate());
    setCustom(next === 'custom');
    if (next === 'thisMonth') onChange({});
    if (next === 'lastMonth') onChange(lastMonth);
    // A custom period starts from the one on screen.
    if (next === 'custom') onChange(period);
  }

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start">
      <Field className="md:w-44">
        <FieldLabel id={id} render={<span />}>
          {t('reports.period.label')}
        </FieldLabel>
        <ChoiceSelect
          labelledBy={id}
          items={PRESETS.map((value) => ({ value, label: t(`reports.period.${value}`) }))}
          value={preset}
          onChange={(next) => pick(next as Preset)}
        />
      </Field>
      {preset === 'custom' && (
        <>
          <Field invalid={!valid} className="md:w-44">
            <FieldLabel>{t('reports.period.from')}</FieldLabel>
            <Input
              type="date"
              value={search.from ?? period.from}
              onChange={(event) =>
                event.target.value && onChange({ from: event.target.value, to: period.to })
              }
            />
          </Field>
          <Field invalid={!valid} className="md:w-44">
            <FieldLabel>{t('reports.period.to')}</FieldLabel>
            <Input
              type="date"
              value={search.to ?? period.to}
              onChange={(event) =>
                event.target.value && onChange({ from: period.from, to: event.target.value })
              }
            />
            <FieldError match={!valid}>
              {t('reports.period.invalid', { days: formatNumber(REPORT_PERIOD_MAX_DAYS) })}
            </FieldError>
          </Field>
        </>
      )}
    </div>
  );
}

/** Months a monthly report can cover (rule 17: up to the current one), named in Arabic. */
const MONTH_CHOICES = 36;

export function MonthSelect({
  value,
  onChange,
  labelledBy,
  label,
  className,
}: {
  value: string;
  onChange: (month: string) => void;
  labelledBy?: string;
  label?: string;
  className?: string;
}) {
  const months = recentMonths(businessDate().slice(0, 7), MONTH_CHOICES);
  // A month further back, reached by its link, stays offered.
  if (!months.includes(value)) months.push(value);
  return (
    <ChoiceSelect
      labelledBy={labelledBy}
      label={label}
      className={className}
      items={months.map((month) => ({ value: month, label: formatMonth(`${month}-01`) }))}
      value={value}
      onChange={onChange}
    />
  );
}

/** Rule 24: the API builds the workbook on request; the browser downloads it. */
export function ExportButton({ href, disabled }: { href: string; disabled?: boolean }) {
  const { t } = useTranslation();
  if (disabled) {
    return (
      <Button variant="outline" disabled>
        <FileSpreadsheetIcon />
        {t('reports.export')}
      </Button>
    );
  }
  return (
    <Button variant="outline" render={<a href={href} download />}>
      <FileSpreadsheetIcon />
      {t('reports.export')}
    </Button>
  );
}

export function BackToReports() {
  const { t } = useTranslation();
  return (
    <div>
      <Button variant="ghost" size="sm" render={<Link to="/reports" />}>
        <ArrowRightIcon className="ltr:-scale-x-100" />
        {t('reports.back')}
      </Button>
    </div>
  );
}
