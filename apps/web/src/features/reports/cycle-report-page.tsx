import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { CycleReport } from '@vertex-hub/contracts';
import { Badge, Button, Callout, EmptyState, PageHeader, Skeleton, toast } from '@vertex-hub/ui';
import {
  ArrowRightIcon,
  CalendarOffIcon,
  DownloadIcon,
  FileTextIcon,
  HourglassIcon,
  LoaderCircleIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { formatNumber, formatPeriod } from '../../lib/format';
import { useFocusAfterChange } from '../../lib/use-focus-after-change';
import { DeliveryRate } from '../retainers/retainer-badges';
import { ExportButton } from './report-parts';
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
  cycleReportPdfReadyQuery,
  cycleReportPdfUrl,
  cycleReportQuery,
  reportExportUrls,
  reportsKeys,
  useRenderCycleReport,
  useSaveCycleReportSummary,
} from './reports.queries';

/**
 * F05C screen 9: a retainer cycle's report as it will print (R2), with the summary the account
 * manager writes and its PDF (R3) and Excel. The open cycle's report is preliminary.
 */
export function CycleReportPage({ retainerId, cycleId }: { retainerId: string; cycleId: string }) {
  const { t } = useTranslation();
  const report = useQuery(cycleReportQuery(retainerId, cycleId));
  const cycleName = report.data
    ? t('retainers.cycleNumber', { number: formatNumber(report.data.cycle.number) })
    : null;

  return (
    <>
      <div>
        <Button
          variant="ghost"
          size="sm"
          render={
            <Link to="/retainers/$retainerId" params={{ retainerId }} search={{ tab: 'history' }} />
          }
        >
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {report.data
            ? t('reports.cycle.backTo', { name: report.data.retainer.name })
            : t('reports.cycle.backToRetainer')}
        </Button>
      </div>
      <PageHeader
        title={
          report.data && cycleName
            ? t('reports.cycle.pageTitle', { cycle: cycleName, name: report.data.retainer.name })
            : t('reports.cycle.title')
        }
        description={
          report.data
            ? `${report.data.client.name} · ${formatPeriod(report.data.period.from, report.data.period.to)}`
            : undefined
        }
        actions={
          report.isSuccess && (
            <div className="flex flex-wrap items-center gap-2">
              {/* The PDF is of the report as it is now: a saved summary asks for a new one. */}
              <CycleReportPdf
                key={report.data.summary?.updatedAt ?? ''}
                retainerId={retainerId}
                cycleId={cycleId}
              />
              <ExportButton href={reportExportUrls.cycleReport(retainerId, cycleId)} />
            </div>
          )
        }
      />
      {report.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      ) : report.isError ? (
        <LoadError
          message={t('reports.cycle.loadError')}
          onRetry={() => report.refetch()}
          error={report.error}
        />
      ) : (
        <ReportBody report={report.data} retainerId={retainerId} cycleId={cycleId} />
      )}
    </>
  );
}

function ReportBody({
  report,
  retainerId,
  cycleId,
}: {
  report: CycleReport;
  retainerId: string;
  cycleId: string;
}) {
  const { t } = useTranslation();
  const save = useSaveCycleReportSummary(retainerId, cycleId);
  const next = report.nextPeriod;
  return (
    <>
      {report.preliminary && (
        <Callout
          tone="warning"
          icon={<HourglassIcon />}
          title={t('reports.cycle.preliminary')}
          description={t('reports.cycle.preliminaryHint')}
        />
      )}
      <SummaryEditor
        label={t('reports.cycle.summary')}
        placeholder={t('reports.cycle.summaryPlaceholder')}
        summary={report.summary}
        saving={save.isPending}
        save={async (summary) => (await save.mutateAsync({ summary })).summary}
      />
      <ReportSection title={t('reports.cycle.deliverables')}>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-4">
          <span className="text-sm text-muted-foreground">{t('reports.cycle.deliveryRate')}</span>
          <DeliveryRate rate={report.deliveryRate} />
        </div>
        {report.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('retainers.noLines')}</p>
        ) : (
          <CycleLinesTable lines={report.lines} />
        )}
      </ReportSection>
      {report.empty ? (
        <EmptyState icon={<CalendarOffIcon />} title={t('reports.cycle.noActivity')} />
      ) : (
        <>
          <DeliveredSection report={report} />
          <PostsSection report={report} />
          <ShootsSection report={report} />
          <ApprovalsSection report={report} />
          <CampaignsSection report={report} />
          <AdBudgetSection
            report={report}
            labels={{ opening: t('reports.cycle.opening'), closing: t('reports.cycle.closing') }}
          />
          <PlansSection
            title={t('reports.cycle.nextPeriod', {
              period: formatPeriod(next.period.from, next.period.to),
            })}
            plans={next}
          />
        </>
      )}
    </>
  );
}

/**
 * R3: the stored PDF when it is the report as it is now, else a new render the page looks for
 * until it is ready; then the download.
 */
function CycleReportPdf({ retainerId, cycleId }: { retainerId: string; cycleId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const render = useRenderCycleReport(retainerId, cycleId);
  const [asked, setAsked] = useState(false);
  const ready = useQuery({ ...cycleReportPdfReadyQuery(retainerId, cycleId), enabled: asked });
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
      await render.mutateAsync();
      // Asking again after giving up looks for the new render from the start.
      await queryClient.resetQueries({
        queryKey: reportsKeys.cycleReportPdf(retainerId, cycleId),
      });
      setAsked(true);
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  if (state === 'ready') {
    return (
      <Button
        render={
          <a
            ref={downloadRef}
            href={cycleReportPdfUrl(retainerId, cycleId)}
            target="_blank"
            rel="noopener"
          />
        }
      >
        <DownloadIcon />
        {t('reports.client.downloadPdf')}
      </Button>
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
