import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { addMonths, businessDate, type ClientMonthlyReport } from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  IconButton,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
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
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import {
  formatCalendarDate,
  formatMonth,
  formatNumber,
  formatRetainerCycle,
} from '../../lib/format';
import { monthParam } from '../../lib/search-params';
import { useFocusAfterChange } from '../../lib/use-focus-after-change';
import { EmailHistory } from '../email/email-history';
import { SendEmailDialog } from '../email/send-email-dialog';
import { ProjectStatusBadge } from '../projects/project-badges';
import { DeliveryRate } from '../retainers/retainer-badges';
import { ExportButton, MonthSelect } from './report-parts';
import {
  AdBudgetSection,
  ApprovalsSection,
  CampaignsSection,
  CycleLinesTable,
  DeliveredSection,
  PlansSection,
  PostsSection,
  ReportSection,
  ShootsSection,
  SummaryEditor,
} from './report-sections';
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
      <IconButton
        variant="outline"
        size="icon"
        label={t('reports.client.previousMonth')}
        onClick={() => shift(-1)}
      >
        <ChevronRightIcon className="ltr:-scale-x-100" />
      </IconButton>
      <MonthSelect
        label={t('reports.client.month')}
        className="w-48"
        value={month}
        onChange={onChange}
      />
      {/* Stays focusable on the current month, so reaching it keeps the focus here. */}
      <IconButton
        variant="outline"
        size="icon"
        label={t('reports.client.nextMonth')}
        disabled={month >= thisMonth}
        focusableWhenDisabled
        onClick={() => shift(1)}
      >
        <ChevronLeftIcon className="ltr:-scale-x-100" />
      </IconButton>
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
      <MonthSummary key={report.month} report={report} clientId={clientId} />
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
          <AdBudgetSection
            report={report}
            labels={{ opening: t('reports.client.opening'), closing: t('reports.client.closing') }}
          />
          <PlansSection title={t('reports.client.sections.nextMonth')} plans={report.nextMonth} />
        </>
      )}
      <EmailHistory target={{ type: 'report', clientId, month: report.month }} />
    </>
  );
}

/** Rule 19: the month's summary. */
function MonthSummary({ report, clientId }: { report: ClientMonthlyReport; clientId: string }) {
  const { t } = useTranslation();
  const save = useSaveClientReportSummary(clientId);
  return (
    <SummaryEditor
      label={t('reports.client.sections.summary')}
      placeholder={t('reports.client.summaryPlaceholder')}
      summary={report.summary}
      saving={save.isPending}
      save={async (summary) => (await save.mutateAsync({ month: report.month, summary })).summary}
    />
  );
}

function RetainersSection({ report }: { report: ClientMonthlyReport }) {
  const { t } = useTranslation();
  if (report.retainers.length === 0) return null;
  return (
    <ReportSection title={t('reports.client.sections.retainers')}>
      {report.retainers.map((row) => (
        // R4: one row per cycle overlapping the month, so a retainer can appear twice.
        <div key={`${row.retainer.id}-${row.cycle}`} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/retainers/$retainerId"
              params={{ retainerId: row.retainer.id }}
              className="font-bold hover:underline"
            >
              {row.retainer.name}
            </Link>
            <span className="text-sm text-muted-foreground">
              {formatRetainerCycle({ number: row.cycle, ...row })}
            </span>
            <Badge tone={row.status === 'open' ? 'info' : 'neutral'}>
              {t(`retainers.cycleStatuses.${row.status}`)}
            </Badge>
            <span className="ms-auto flex items-center gap-2 text-sm">
              {t('reports.client.completion')}
              <DeliveryRate rate={row.completion} />
            </span>
            {/* F05C screen 9: each cycle has its own report. */}
            <Button
              variant="outline"
              size="sm"
              render={
                <Link
                  to="/retainers/$retainerId/cycles/$cycleId/report"
                  params={{ retainerId: row.retainer.id, cycleId: row.cycleId }}
                />
              }
            >
              <FileTextIcon />
              {t('reports.cycle.open')}
            </Button>
          </div>
          <CycleLinesTable lines={row.lines} />
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
                {row.totalTasks === 0 ? (
                  <span className="text-muted-foreground">{t('common.none')}</span>
                ) : (
                  t('reports.client.progressOf', {
                    delivered: formatNumber(row.deliveredTasks),
                    total: formatNumber(row.totalTasks),
                  })
                )}
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
  const state = !asked
    ? 'idle'
    : ready.isSuccess
      ? 'ready'
      : ready.isError
        ? 'failed'
        : 'preparing';
  const prepareRef = useRef<HTMLButtonElement>(null);
  const downloadRef = useRef<HTMLAnchorElement>(null);
  useFocusAfterChange(state, () => (state === 'ready' ? downloadRef.current : prepareRef.current));

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

  if (state === 'ready') {
    return (
      <>
        <Button
          render={
            <a
              ref={downloadRef}
              href={clientReportPdfUrl(clientId, month)}
              target="_blank"
              rel="noopener"
            />
          }
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
  // One button while it is asked for and prepared, so the focus stays on it.
  const preparing = state === 'preparing';
  return (
    <span className="flex flex-wrap items-center gap-2">
      {state === 'failed' && <Badge tone="danger">{t('invoices.pdf.failed')}</Badge>}
      <Button
        ref={prepareRef}
        variant="outline"
        disabled={preparing || render.isPending}
        focusableWhenDisabled
        onClick={ask}
      >
        {preparing ? (
          <LoaderCircleIcon
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
          />
        ) : (
          <FileTextIcon />
        )}
        {preparing
          ? t('reports.client.preparing')
          : state === 'failed'
            ? t('invoices.pdf.renderAgain')
            : t('reports.client.preparePdf')}
      </Button>
      <span role="status" className="sr-only">
        {preparing ? t('reports.client.preparing') : ''}
      </span>
    </span>
  );
}
