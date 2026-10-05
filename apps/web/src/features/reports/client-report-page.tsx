import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  addMonths,
  businessDate,
  CLIENT_REPORT_SUMMARY_MAX,
  type ClientMonthlyReport,
  responseTime,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  FieldDescription,
  FieldLabel,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import {
  ArrowRightIcon,
  CalendarOffIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileTextIcon,
  HourglassIcon,
  LoaderCircleIcon,
  MailIcon,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { formatCalendarDate, formatDateTime, formatMonth, formatNumber } from '../../lib/format';
import { monthParam } from '../../lib/search-params';
import { CostPerResult, PlatformName } from '../campaigns/campaign-badges';
import { PostPlatforms } from '../content/post-parts';
import { EmailHistory } from '../email/email-history';
import { SendEmailDialog } from '../email/send-email-dialog';
import { ProjectStatusBadge } from '../projects/project-badges';
import { Money } from '../quotes/quote-badges';
import { DeliveryRate, lineName } from '../retainers/retainer-badges';
import { ExportButton, MonthSelect } from './report-parts';
import {
  clientReportPdfReadyQuery,
  clientReportPdfUrl,
  clientReportQuery,
  reportExportUrls,
  reportsKeys,
  useRenderClientReport,
  useSaveClientReportSummary,
} from './reports.queries';

export interface ClientReportSearch {
  /** `YYYY-MM`; unset means last month. */
  month?: string;
}

export function parseClientReportSearch(search: Record<string, unknown>): ClientReportSearch {
  return { month: monthParam(search.month) };
}

const lastMonth = () => addMonths(businessDate(), -1).slice(0, 7);

/**
 * Screen 6: the monthly client report as it will print (rule 18), with the summary the account
 * manager writes (rule 19), its PDF (rule 20) and Excel (rule 24). The current month is
 * preliminary (rule 17).
 */
export function ClientReportPage({
  clientId,
  search,
}: {
  clientId: string;
  search: ClientReportSearch;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/clients/$clientId/report' });
  const thisMonth = businessDate().slice(0, 7);
  const month = search.month ?? lastMonth();
  const future = month > thisMonth;
  const report = useQuery({ ...clientReportQuery(clientId, month), enabled: !future });
  const goTo = (next: string) => navigate({ search: { month: next }, replace: true });

  return (
    <>
      <div>
        <Button
          variant="ghost"
          size="sm"
          render={<Link to="/clients/$clientId" params={{ clientId }} />}
        >
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {report.data
            ? t('reports.client.backTo', { name: report.data.client.name })
            : t('reports.client.backToClient')}
        </Button>
      </div>
      <PageHeader
        title={
          report.data
            ? t('reports.client.pageTitle', { name: report.data.client.name })
            : t('reports.client.title')
        }
        description={formatMonth(`${month}-01`)}
        actions={
          report.isSuccess && (
            <div className="flex flex-wrap items-center gap-2">
              {/* The PDF is of the report as it is now: a saved summary asks for a new one. */}
              <ClientReportPdf
                key={`${month}-${report.data.summary?.updatedAt ?? ''}`}
                clientId={clientId}
                month={month}
                clientName={report.data.client.name}
              />
              <ExportButton href={reportExportUrls.clientReport(clientId, month)} />
            </div>
          )
        }
      />
      <MonthPicker month={month} thisMonth={thisMonth} onChange={goTo} />
      {future ? (
        <EmptyState
          icon={<CalendarOffIcon />}
          title={t('errors.INVALID_MONTH')}
          action={
            <Button variant="outline" onClick={() => goTo(thisMonth)}>
              {t('reports.client.toThisMonth')}
            </Button>
          }
        />
      ) : report.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      ) : report.isError ? (
        <LoadError
          message={t('reports.client.loadError')}
          onRetry={() => report.refetch()}
          error={report.error}
        />
      ) : (
        <ReportBody report={report.data} clientId={clientId} />
      )}
    </>
  );
}

function MonthPicker({
  month,
  thisMonth,
  onChange,
}: {
  month: string;
  thisMonth: string;
  onChange: (month: string) => void;
}) {
  const { t } = useTranslation();
  const shift = (months: number) => onChange(addMonths(`${month}-01`, months).slice(0, 7));
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-3">
      <Button
        variant="outline"
        size="icon"
        aria-label={t('reports.client.previousMonth')}
        onClick={() => shift(-1)}
      >
        <ChevronRightIcon className="ltr:-scale-x-100" />
      </Button>
      <MonthSelect
        label={t('reports.client.month')}
        className="w-48"
        value={month}
        onChange={onChange}
      />
      <Button
        variant="outline"
        size="icon"
        aria-label={t('reports.client.nextMonth')}
        disabled={month >= thisMonth}
        onClick={() => shift(1)}
      >
        <ChevronLeftIcon className="ltr:-scale-x-100" />
      </Button>
    </div>
  );
}

function ReportBody({ report, clientId }: { report: ClientMonthlyReport; clientId: string }) {
  const { t } = useTranslation();
  return (
    <>
      {report.preliminary && (
        <Callout
          tone="warning"
          icon={<HourglassIcon />}
          title={t('reports.client.preliminary')}
          description={t('reports.client.preliminaryHint')}
        />
      )}
      <SummaryEditor key={report.month} report={report} clientId={clientId} />
      {report.empty ? (
        <EmptyState icon={<CalendarOffIcon />} title={t('reports.client.noActivity')} />
      ) : (
        <>
          <RetainersSection report={report} />
          <ProjectsSection report={report} />
          <DeliveredSection report={report} />
          <PostsSection report={report} />
          <ShootsSection report={report} />
          <ApprovalsSection report={report} />
          <CampaignsSection report={report} />
          <AdBudgetSection report={report} />
          <NextMonthSection report={report} />
        </>
      )}
      <EmailHistory target={{ type: 'report', clientId, month: report.month }} />
    </>
  );
}

/** Rule 19: any reader of the report writes the month's summary; the last save wins. */
function SummaryEditor({ report, clientId }: { report: ClientMonthlyReport; clientId: string }) {
  const { t } = useTranslation();
  const id = useId();
  const save = useSaveClientReportSummary(clientId);
  const stored = report.summary?.text ?? '';
  const [text, setText] = useState(stored);
  const [failure, setFailure] = useState<string | null>(null);
  const tooLong = text.length > CLIENT_REPORT_SUMMARY_MAX;
  const changed = text.trim() !== stored;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (tooLong || !changed) return;
    setFailure(null);
    try {
      await save.mutateAsync({ month: report.month, summary: text });
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
            {t('reports.client.sections.summary')}
          </FieldLabel>
          <Textarea
            id={id}
            rows={5}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('reports.client.summaryPlaceholder')}
          />
          <FieldDescription>
            {t('reports.client.summaryCount', {
              n: formatNumber(text.length),
              max: formatNumber(CLIENT_REPORT_SUMMARY_MAX),
            })}
            {report.summary &&
              ` · ${t('reports.client.summaryBy', {
                name: report.summary.updatedBy.name,
                when: formatDateTime(report.summary.updatedAt),
              })}`}
          </FieldDescription>
        </Field>
        {failure && <FormAlert>{failure}</FormAlert>}
        <div>
          <Button type="submit" disabled={save.isPending || tooLong || !changed}>
            {save.isPending ? t('common.saving') : t('reports.client.saveSummary')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-4">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </Card>
  );
}

function RetainersSection({ report }: { report: ClientMonthlyReport }) {
  const { t } = useTranslation();
  if (report.retainers.length === 0) return null;
  return (
    <ReportSection title={t('reports.client.sections.retainers')}>
      {report.retainers.map((row) => (
        <div key={row.retainer.id} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/retainers/$retainerId"
              params={{ retainerId: row.retainer.id }}
              className="font-bold hover:underline"
            >
              {row.retainer.name}
            </Link>
            <Badge tone={row.status === 'open' ? 'info' : 'neutral'}>
              {t(`retainers.cycleStatuses.${row.status}`)}
            </Badge>
            <span className="ms-auto flex items-center gap-2 text-sm">
              {t('reports.client.completion')}
              <DeliveryRate rate={row.completion} />
            </span>
          </div>
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
              {row.lines.map((line, index) => (
                <TableRow key={`${line.kind}-${line.label ?? index}`}>
                  <TableCell>{lineName(t, line)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatNumber(line.committed)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatNumber(line.delivered)}
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
        </div>
      ))}
    </ReportSection>
  );
}

function ProjectsSection({ report }: { report: ClientMonthlyReport }) {
  const { t } = useTranslation();
  if (report.projects.length === 0) return null;
  return (
    <ReportSection title={t('reports.client.sections.projects')}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('reports.client.project')}</TableHead>
            <TableHead>{t('reports.client.status')}</TableHead>
            <TableHead className="text-end">{t('reports.client.progress')}</TableHead>
            <TableHead>{t('reports.client.milestonesDone')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.projects.map((row) => (
            <TableRow key={row.project.id}>
              <TableCell>
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: row.project.id }}
                  className="font-medium hover:underline"
                >
                  {row.project.name}
                </Link>
              </TableCell>
              <TableCell>
                <ProjectStatusBadge status={row.status} />
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {t('reports.client.progressOf', {
                  delivered: formatNumber(row.deliveredTasks),
                  total: formatNumber(row.totalTasks),
                })}
              </TableCell>
              <TableCell className="whitespace-normal">
                {row.milestonesDone.length === 0 ? (
                  <span className="text-muted-foreground">{t('common.none')}</span>
                ) : (
                  <ul className="flex flex-col gap-0.5 text-sm">
                    {row.milestonesDone.map((milestone) => (
                      <li key={`${milestone.name}-${milestone.doneOn}`}>
                        {milestone.name} · {formatCalendarDate(milestone.doneOn)}
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

function DeliveredSection({ report }: { report: ClientMonthlyReport }) {
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

function PostsSection({ report }: { report: ClientMonthlyReport }) {
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

function ShootsSection({ report }: { report: ClientMonthlyReport }) {
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

function ApprovalsSection({ report }: { report: ClientMonthlyReport }) {
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

function CampaignsSection({ report }: { report: ClientMonthlyReport }) {
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

function MetricCells({
  metrics,
}: {
  metrics: NonNullable<ClientMonthlyReport['campaigns']>['totals'];
}) {
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

function AdBudgetSection({ report }: { report: ClientMonthlyReport }) {
  const { t } = useTranslation();
  const budget = report.adBudget;
  if (!budget) return null;
  const rows = [
    { label: t('reports.client.opening'), minor: budget.openingMinor },
    { label: t('reports.client.deposits'), minor: budget.depositsMinor },
    { label: t('reports.client.refunds'), minor: budget.refundsMinor },
    { label: t('reports.client.walletSpend'), minor: budget.spendMinor },
    { label: t('reports.client.closing'), minor: budget.closingMinor, strong: true },
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

function NextMonthSection({ report }: { report: ClientMonthlyReport }) {
  const { t } = useTranslation();
  const { posts, shoots } = report.nextMonth;
  if (posts.length + shoots.length === 0) return null;
  const groups = [
    { key: 'plannedPosts', rows: posts },
    { key: 'bookedShoots', rows: shoots },
  ] as const;
  return (
    <ReportSection title={t('reports.client.sections.nextMonth')}>
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

/**
 * Rule 20: the PDF is rendered on request; once asked for, the page looks for it until it is
 * ready, then offers the download (valid for 24 hours). As F13 statements.
 */
function ClientReportPdf({
  clientId,
  month,
  clientName,
}: {
  clientId: string;
  month: string;
  clientName: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const render = useRenderClientReport(clientId);
  const [asked, setAsked] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const ready = useQuery({ ...clientReportPdfReadyQuery(clientId, month), enabled: asked });

  async function ask() {
    try {
      await render.mutateAsync(month);
      // Asking again after giving up looks for the new render from the start.
      await queryClient.resetQueries({ queryKey: reportsKeys.clientReportPdf(clientId, month) });
      setAsked(true);
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  if (asked && ready.isSuccess) {
    return (
      <>
        <Button
          render={<a href={clientReportPdfUrl(clientId, month)} target="_blank" rel="noopener" />}
        >
          <DownloadIcon />
          {t('reports.client.downloadPdf')}
        </Button>
        <Button variant="outline" onClick={() => setEmailing(true)}>
          <MailIcon />
          {t('email.send.action')}
        </Button>
        <SendEmailDialog
          open={emailing}
          onClose={() => setEmailing(false)}
          clientId={clientId}
          target={{ type: 'report', clientId, month }}
          draft={{ kind: 'client_report', data: { month } }}
          attachment={{ fileName: `${clientName} - Report ${month}.pdf`, ready: true }}
        />
      </>
    );
  }
  const gaveUp = asked && ready.isError;
  if (asked && !gaveUp) {
    return (
      <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircleIcon
          aria-hidden="true"
          className="size-4 animate-spin motion-reduce:animate-none"
        />
        {t('reports.client.preparing')}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      {gaveUp && <Badge tone="danger">{t('invoices.pdf.failed')}</Badge>}
      <Button variant="outline" disabled={render.isPending} onClick={ask}>
        <FileTextIcon />
        {gaveUp ? t('invoices.pdf.renderAgain') : t('reports.client.preparePdf')}
      </Button>
    </span>
  );
}
