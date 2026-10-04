import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ClientMonthlyReport,
  DepartmentCode,
  OverdueInvoicesQuery,
  ProductivityQuery,
  RevenueQuery,
  UpdateClientReportSummary,
} from '@vertex-hub/contracts';
import { ApiError, api, call } from '../../lib/api/client';

/*
 * Dashboards and reports (spec F15): computed by the API on every read, so nothing here is kept
 * longer than the screen that shows it.
 */

export const reportsKeys = {
  all: ['reports'] as const,
  dashboard: ['reports', 'dashboard'] as const,
  company: ['reports', 'dashboard', 'company'] as const,
  finance: ['reports', 'dashboard', 'finance'] as const,
  departments: (department: DepartmentCode | undefined) =>
    ['reports', 'dashboard', 'departments', department ?? null] as const,
  myClients: ['reports', 'dashboard', 'clients'] as const,
  productivity: (query: ProductivityQuery) => ['reports', 'productivity', query] as const,
  revenue: (query: RevenueQuery) => ['reports', 'revenue', query] as const,
  overdueInvoices: (query: OverdueInvoicesQuery) => ['reports', 'overdue-invoices', query] as const,
  clientReport: (clientId: string, month: string) =>
    ['reports', 'client-report', clientId, month] as const,
  clientReportPdf: (clientId: string, month: string) =>
    ['reports', 'client-report-pdf', clientId, month] as const,
};

export const companyDashboardQuery = queryOptions({
  queryKey: reportsKeys.company,
  queryFn: () => call(api.GET('/api/dashboard/company')),
});

export const financeDashboardQuery = queryOptions({
  queryKey: reportsKeys.finance,
  queryFn: () => call(api.GET('/api/dashboard/finance')),
});

export const departmentDashboardQuery = (department: DepartmentCode | undefined) =>
  queryOptions({
    queryKey: reportsKeys.departments(department),
    queryFn: () =>
      call(api.GET('/api/dashboard/departments', { params: { query: { department } } })),
    placeholderData: keepPreviousData,
  });

export const myClientsDashboardQuery = queryOptions({
  queryKey: reportsKeys.myClients,
  queryFn: () => call(api.GET('/api/dashboard/clients')),
});

export const productivityReportQuery = (query: ProductivityQuery) =>
  queryOptions({
    queryKey: reportsKeys.productivity(query),
    queryFn: () => call(api.GET('/api/reports/productivity', { params: { query } })),
    placeholderData: keepPreviousData,
  });

export const revenueReportQuery = (query: RevenueQuery) =>
  queryOptions({
    queryKey: reportsKeys.revenue(query),
    queryFn: () => call(api.GET('/api/reports/revenue', { params: { query } })),
    placeholderData: keepPreviousData,
  });

export const overdueInvoicesReportQuery = (query: OverdueInvoicesQuery) =>
  queryOptions({
    queryKey: reportsKeys.overdueInvoices(query),
    queryFn: () => call(api.GET('/api/reports/overdue-invoices', { params: { query } })),
    placeholderData: keepPreviousData,
  });

export const clientReportQuery = (clientId: string, month: string) =>
  queryOptions({
    queryKey: reportsKeys.clientReport(clientId, month),
    queryFn: () =>
      call(
        api.GET('/api/clients/{id}/monthly-report', {
          params: { path: { id: clientId }, query: { month } },
        }),
      ),
  });

/** A query string from the set values only (`department` repeats, as the API reads lists). */
function queryString(values: Record<string, string | readonly string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    for (const item of typeof value === 'string' ? [value] : value) params.append(key, item);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** The Excel files (rule 24), built by the API on request and served as downloads. */
export const reportExportUrls = {
  productivity: (query: ProductivityQuery) =>
    `/api/reports/productivity/export${queryString(query)}`,
  revenue: (query: RevenueQuery) => `/api/reports/revenue/export${queryString(query)}`,
  overdueInvoices: (query: OverdueInvoicesQuery) =>
    `/api/reports/overdue-invoices/export${queryString(query)}`,
  clientReport: (clientId: string, month: string) =>
    `/api/clients/${clientId}/monthly-report/export${queryString({ month })}`,
};

/** The monthly report's PDF (rule 20), downloadable for 24 hours once it is ready. */
export const clientReportPdfUrl = (clientId: string, month: string) =>
  `/api/clients/${clientId}/monthly-report/pdf${queryString({ month })}`;

/** How often, and how many times, a PDF being rendered is looked for (2 minutes in all). */
const PDF_POLL_MS = 3000;
const PDF_TRIES = 40;

/**
 * Resolves once the asked-for PDF can be downloaded: the download answers 404 until the worker
 * has rendered it, so a `HEAD` request tells without fetching the file. Only that 404 is retried;
 * any other failure is an `ApiError` the app's error handling sees at once (as F13 statements).
 */
export const clientReportPdfReadyQuery = (clientId: string, month: string) =>
  queryOptions({
    queryKey: reportsKeys.clientReportPdf(clientId, month),
    queryFn: async () => {
      const response = await fetch(clientReportPdfUrl(clientId, month), { method: 'HEAD' });
      if (!response.ok) {
        throw new ApiError(response.status, undefined, undefined, response.statusText);
      }
      return true;
    },
    retry: (failures, error) =>
      error instanceof ApiError && error.status === 404 && failures < PDF_TRIES,
    retryDelay: PDF_POLL_MS,
    gcTime: 0,
  });

/** Asks for the report's PDF as it is now; `pending` until the worker has rendered it. */
export function useRenderClientReport(clientId: string) {
  return useMutation({
    mutationFn: (month: string) =>
      call(
        api.POST('/api/clients/{id}/monthly-report/pdf', {
          params: { path: { id: clientId }, query: { month } },
        }),
      ),
  });
}

/** Rule 19: the answer is the whole report with the new summary. */
export function useSaveClientReportSummary(clientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateClientReportSummary) =>
      call(
        api.PUT('/api/clients/{id}/monthly-report/summary', {
          params: { path: { id: clientId } },
          body: input,
        }),
      ),
    onSuccess: (report: ClientMonthlyReport) =>
      queryClient.setQueryData(reportsKeys.clientReport(clientId, report.month), report),
  });
}
