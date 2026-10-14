import { Link } from '@tanstack/react-router';
import {
  CLIENT_REPORT_SUMMARY_MAX,
  type ClientMonthlyReport,
  responseTime,
} from '@vertex-hub/contracts';
import {
  Button,
  Card,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { errorMessage } from '../../lib/errors';
import { formatCalendarDate, formatDateTime, formatNumber } from '../../lib/format';
import { CostPerResult, PlatformName } from '../campaigns/campaign-badges';
import { PostPlatforms } from '../content/post-parts';
import { Money } from '../quotes/quote-badges';
import { lineName } from '../retainers/retainer-badges';

/*
 * The sections the monthly client report (F15 screen 6) and the retainer cycle report (F05C
 * screen 9) share: the summary editor, a cycle's lines, and rule 18.4–18.10's sections.
 */

/** The sections both reports carry, with the same shapes. */
type Activity = Pick<
  ClientMonthlyReport,
  'deliveredWork' | 'posts' | 'shoots' | 'approvals' | 'campaigns' | 'adBudget'
>;

type Summary = ClientMonthlyReport['summary'];

/**
 * F15 rule 19, F05C R3: any reader of the report writes its summary; the last save wins. `save`
 * answers with the summary as stored.
 */
export function SummaryEditor({
  label,
  placeholder,
  summary,
  save,
  saving,
}: {
  label: string;
  placeholder: string;
  summary: Summary;
  save: (text: string) => Promise<Summary>;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const stored = summary?.text ?? '';
  const [text, setText] = useState(stored);
  const [failure, setFailure] = useState<string | null>(null);
  const tooLong = text.trim().length > CLIENT_REPORT_SUMMARY_MAX;
  const changed = text.trim() !== stored;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (tooLong || !changed) return;
    setFailure(null);
    try {
      const saved = await save(text);
      // The text as stored: trimmed, or empty once cleared.
      setText(saved?.text ?? '');
      toast.add({ title: t('reports.client.summarySaved'), type: 'success' });
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <Card className="gap-3">
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <Field invalid={tooLong}>
          <FieldLabel htmlFor={id} className="text-lg font-bold">
            {label}
          </FieldLabel>
          <Textarea
            id={id}
            rows={5}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={placeholder}
          />
          <FieldDescription>
            {t('reports.client.summaryCount', {
              n: formatNumber(text.length),
              max: formatNumber(CLIENT_REPORT_SUMMARY_MAX),
            })}
            {summary &&
              ` · ${t('reports.client.summaryBy', {
                name: summary.updatedBy.name,
                when: formatDateTime(summary.updatedAt),
              })}`}
          </FieldDescription>
          <FieldError match={tooLong}>
            {t('reports.client.summaryTooLong', {
              max: formatNumber(CLIENT_REPORT_SUMMARY_MAX),
            })}
          </FieldError>
        </Field>
        {failure && <FormAlert>{failure}</FormAlert>}
        <div>
          {/* Stays focusable once saved (nothing left to save), so the focus stays here. */}
          <Button type="submit" disabled={saving || tooLong || !changed} focusableWhenDisabled>
            {saving ? t('common.saving') : t('reports.client.saveSummary')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-4">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </Card>
  );
}

/** A cycle's lines with their counts and percents (F15 rule 18.2, F05C R2). */
export function CycleLinesTable({
  lines,
}: {
  lines: ClientMonthlyReport['retainers'][number]['lines'];
}) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('reports.client.kind')}</TableHead>
          <TableHead className="text-end">{t('reports.client.committed')}</TableHead>
          <TableHead className="text-end">{t('reports.client.delivered')}</TableHead>
          <TableHead className="text-end">{t('reports.client.percent')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line, index) => (
          <TableRow key={`${line.kind}-${line.label ?? index}`}>
            <TableCell>{lineName(t, line)}</TableCell>
            <TableCell className="text-end tabular-nums">{formatNumber(line.committed)}</TableCell>
            <TableCell className="text-end tabular-nums">
              {line.delivered === null ? t('common.none') : formatNumber(line.delivered)}
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {line.percent === null
                ? t('common.none')
                : formatNumber(line.percent / 100, { style: 'percent' })}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function DeliveredSection({ report }: { report: Activity }) {
  const { t } = useTranslation();
  if (report.deliveredWork.length === 0) return null;
  return (
    <ReportSection title={t('reports.client.sections.deliveredWork')}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('reports.client.work')}</TableHead>
            <TableHead>{t('reports.client.department')}</TableHead>
            <TableHead>{t('reports.client.date')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.deliveredWork.map((row) => (
            <TableRow key={row.taskId}>
              <TableCell className="whitespace-normal">
                <Link
                  to="/tasks/$taskId"
                  params={{ taskId: row.taskId }}
                  className="font-medium hover:underline"
                >
                  {row.title}
                </Link>
              </TableCell>
              <TableCell>{row.departmentName}</TableCell>
              <TableCell>{formatCalendarDate(row.deliveredOn)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportSection>
  );
}

export function PostsSection({ report }: { report: Activity }) {
  const { t } = useTranslation();
  if (report.posts.length === 0) return null;
  return (
    <ReportSection title={t('reports.client.sections.posts')}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('reports.client.date')}</TableHead>
            <TableHead>{t('reports.client.platforms')}</TableHead>
            <TableHead>{t('reports.client.postTitle')}</TableHead>
            <TableHead>{t('reports.client.links')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.posts.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{formatCalendarDate(row.publishedOn)}</TableCell>
              <TableCell>
                <PostPlatforms platforms={row.platforms} />
              </TableCell>
              <TableCell className="whitespace-normal">
                <Link
                  to="/content/posts/$postId"
                  params={{ postId: row.id }}
                  className="font-medium hover:underline"
                >
                  {row.title}
                </Link>
              </TableCell>
              <TableCell className="whitespace-normal">
                {row.links.length === 0 ? (
                  <span className="text-muted-foreground">{t('common.none')}</span>
                ) : (
                  <ul className="flex flex-col gap-0.5 text-sm">
                    {row.links.map((link) => (
                      <li key={link.url}>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          {t(`clients.platforms.names.${link.platform}`)}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportSection>
  );
}

export function ShootsSection({ report }: { report: Activity }) {
  const { t } = useTranslation();
  if (report.shoots.length === 0) return null;
  return (
    <ReportSection title={t('reports.client.sections.shoots')}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('reports.client.date')}</TableHead>
            <TableHead>{t('reports.client.shoot')}</TableHead>
            <TableHead>{t('reports.client.location')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.shoots.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{formatCalendarDate(row.date)}</TableCell>
              <TableCell className="whitespace-normal">
                <Link
                  to="/shoots/$shootId"
                  params={{ shootId: row.id }}
                  className="font-medium hover:underline"
                >
                  {row.title}
                </Link>
              </TableCell>
              <TableCell className="whitespace-normal">{row.location}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportSection>
  );
}

export function ApprovalsSection({ report }: { report: Activity }) {
  const { t } = useTranslation();
  const { approved, changesRequested, averageResponseHours } = report.approvals;
  if (approved + changesRequested === 0) return null;
  const average = averageResponseHours === null ? null : responseTime(averageResponseHours);
  const facts = [
    { label: t('reports.client.approved'), value: formatNumber(approved) },
    { label: t('reports.client.changesRequested'), value: formatNumber(changesRequested) },
    {
      label: t('reports.client.averageResponse'),
      value: average
        ? t(`reports.client.${average.unit}`, {
            count: average.value,
            n: formatNumber(average.value, { maximumFractionDigits: 1 }),
          })
        : t('common.none'),
    },
  ];
  return (
    <ReportSection title={t('reports.client.sections.approvals')}>
      <dl className="grid gap-3 sm:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.label} className="flex flex-col gap-1 rounded-lg border border-border p-4">
            <dt className="text-sm text-muted-foreground">{fact.label}</dt>
            <dd className="text-xl font-bold tabular-nums">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </ReportSection>
  );
}

export function CampaignsSection({ report }: { report: Activity }) {
  const { t } = useTranslation();
  const campaigns = report.campaigns;
  if (!campaigns || campaigns.rows.length === 0) return null;
  const { totals } = campaigns;
  return (
    <ReportSection title={t('reports.client.sections.campaigns')}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('reports.client.campaign')}</TableHead>
            <TableHead>{t('reports.client.objective')}</TableHead>
            <TableHead className="text-end">{t('reports.client.spend')}</TableHead>
            <TableHead className="text-end">{t('reports.client.reach')}</TableHead>
            <TableHead className="text-end">{t('reports.client.clicks')}</TableHead>
            <TableHead className="text-end">{t('reports.client.results')}</TableHead>
            <TableHead className="text-end">{t('reports.client.costPerResult')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {campaigns.rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="whitespace-normal">
                <span className="flex flex-col gap-1">
                  <Link
                    to="/campaigns/$campaignId"
                    params={{ campaignId: row.id }}
                    className="font-medium hover:underline"
                  >
                    {row.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    <PlatformName platform={row.platform} />
                  </span>
                </span>
              </TableCell>
              <TableCell>{t(`campaigns.objectives.${row.objective}`)}</TableCell>
              <MetricCells metrics={row} />
            </TableRow>
          ))}
          <TableRow className="font-bold">
            <TableCell colSpan={2}>{t('reports.client.total')}</TableCell>
            <MetricCells metrics={totals} />
          </TableRow>
        </TableBody>
      </Table>
    </ReportSection>
  );
}

function MetricCells({ metrics }: { metrics: NonNullable<Activity['campaigns']>['totals'] }) {
  return (
    <>
      <TableCell className="text-end">
        <Money minor={metrics.spendMinor} currency="USD" />
      </TableCell>
      <TableCell className="text-end tabular-nums">{formatNumber(metrics.reach)}</TableCell>
      <TableCell className="text-end tabular-nums">{formatNumber(metrics.clicks)}</TableCell>
      <TableCell className="text-end tabular-nums">{formatNumber(metrics.results)}</TableCell>
      <TableCell className="text-end">
        <CostPerResult minor={metrics.costPerResultMinor} />
      </TableCell>
    </>
  );
}

/** Rule 18.9 over the report's period; `labels` name its opening and closing balances. */
export function AdBudgetSection({
  report,
  labels,
}: {
  report: Activity;
  labels: { opening: string; closing: string };
}) {
  const { t } = useTranslation();
  const budget = report.adBudget;
  if (!budget) return null;
  const rows = [
    { label: labels.opening, minor: budget.openingMinor },
    { label: t('reports.client.deposits'), minor: budget.depositsMinor },
    { label: t('reports.client.refunds'), minor: budget.refundsMinor },
    { label: t('reports.client.walletSpend'), minor: budget.spendMinor },
    { label: labels.closing, minor: budget.closingMinor, strong: true },
  ];
  return (
    <ReportSection title={t('reports.client.sections.adBudget')}>
      <dl className="flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4 py-2">
            <dt className={row.strong ? 'font-bold' : 'text-muted-foreground'}>{row.label}</dt>
            <dd className={row.strong ? 'font-bold' : undefined}>
              <Money
                minor={row.minor}
                currency="USD"
                className={row.minor < 0 ? 'text-destructive-text' : undefined}
              />
            </dd>
          </div>
        ))}
      </dl>
    </ReportSection>
  );
}

/** Rule 18.10: the posts planned and shoots booked in the period after the report's. */
export function PlansSection({
  title,
  plans,
}: {
  title: string;
  plans: ClientMonthlyReport['nextMonth'];
}) {
  const { t } = useTranslation();
  const { posts, shoots } = plans;
  if (posts.length + shoots.length === 0) return null;
  const groups = [
    { key: 'plannedPosts', rows: posts },
    { key: 'bookedShoots', rows: shoots },
  ] as const;
  return (
    <ReportSection title={title}>
      <div className="grid gap-4 md:grid-cols-2">
        {groups
          .filter((group) => group.rows.length > 0)
          .map((group) => (
            <div key={group.key} className="flex flex-col gap-2">
              <h3 className="font-bold">{t(`reports.client.${group.key}`)}</h3>
              <ul className="flex flex-col divide-y divide-border text-sm">
                {group.rows.map((row, index) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: two plans can share a date and title
                    key={index}
                    className="flex gap-3 py-1.5"
                  >
                    <span className="w-28 shrink-0 text-muted-foreground">
                      {formatCalendarDate(row.date)}
                    </span>
                    {row.title}
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </ReportSection>
  );
}
