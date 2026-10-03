import {
  keepPreviousData,
  type QueryKey,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  BillableItemsQuery,
  ChangeInvoiceDueDate,
  ClientStatementQuery,
  CreateInvoice,
  CreateProjectExpense,
  InvoiceDetail,
  InvoiceDraft,
  IssueInvoice,
  ProjectBilling,
  RecordPayment,
  UpdateInvoiceSettings,
  UpdateProjectExpense,
  VoidInvoice,
  VoidPayment,
} from '@vertex-hub/contracts';
import { ApiError, api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';
import { calendarKeys } from '../calendar/calendar.queries';
import { clientsKeys } from '../clients/clients.queries';
import { filesKeys } from '../files/files.queries';
import { projectsKeys } from '../projects/projects.queries';
import { retainersKeys } from '../retainers/retainers.queries';

/** The list endpoint's query string as the API reads it. */
export type InvoiceListFilters = NonNullable<paths['/api/invoices']['get']['parameters']['query']>;

export const invoicesKeys = {
  all: ['invoices'] as const,
  list: (filters: InvoiceListFilters) => ['invoices', 'list', filters] as const,
  detail: (id: string) => ['invoices', 'detail', id] as const,
  settings: ['invoices', 'settings'] as const,
  billable: (query: BillableItemsQuery) => ['invoices', 'billable', query] as const,
  clientBilling: (clientId: string) => ['invoices', 'client-billing', clientId] as const,
  statement: (clientId: string, query: ClientStatementQuery) =>
    ['invoices', 'statement', clientId, query] as const,
  projectBilling: (projectId: string) => ['invoices', 'project-billing', projectId] as const,
  retainerBilling: (retainerId: string) => ['invoices', 'retainer-billing', retainerId] as const,
  statementPdf: (clientId: string, query: ClientStatementQuery) =>
    ['invoices', 'statement-pdf', clientId, query] as const,
};

/** How often an invoice whose PDF or a receipt is being rendered asks again (rules 15 and 20). */
const PDF_POLL_MS = 3000;

export const invoiceListQuery = (filters: InvoiceListFilters) =>
  queryOptions({
    queryKey: invoicesKeys.list(filters),
    queryFn: () => call(api.GET('/api/invoices', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const invoiceQuery = (id: string) =>
  queryOptions({
    queryKey: invoicesKeys.detail(id),
    queryFn: () => call(api.GET('/api/invoices/{id}', { params: { path: { id } } })),
    refetchInterval: (query) => {
      const invoice = query.state.data;
      const rendering =
        invoice?.pdf?.state === 'pending' ||
        invoice?.draftPdf?.state === 'pending' ||
        invoice?.payments.some((payment) => payment.receiptPdf?.state === 'pending');
      return rendering ? PDF_POLL_MS : false;
    },
  });

export const invoiceSettingsQuery = queryOptions({
  queryKey: invoicesKeys.settings,
  queryFn: () => call(api.GET('/api/invoice-settings')),
});

export const billableItemsQuery = (query: BillableItemsQuery) =>
  queryOptions({
    queryKey: invoicesKeys.billable(query),
    queryFn: () => call(api.GET('/api/invoices/billable', { params: { query } })),
  });

export const clientBillingQuery = (clientId: string) =>
  queryOptions({
    queryKey: invoicesKeys.clientBilling(clientId),
    queryFn: () =>
      call(api.GET('/api/clients/{id}/billing', { params: { path: { id: clientId } } })),
  });

export const clientStatementQuery = (clientId: string, query: ClientStatementQuery) =>
  queryOptions({
    queryKey: invoicesKeys.statement(clientId, query),
    queryFn: () =>
      call(api.GET('/api/clients/{id}/statement', { params: { path: { id: clientId }, query } })),
    placeholderData: keepPreviousData,
  });

export const projectBillingQuery = (projectId: string) =>
  queryOptions({
    queryKey: invoicesKeys.projectBilling(projectId),
    queryFn: () =>
      call(api.GET('/api/projects/{id}/billing', { params: { path: { id: projectId } } })),
  });

export const retainerBillingQuery = (retainerId: string) =>
  queryOptions({
    queryKey: invoicesKeys.retainerBilling(retainerId),
    queryFn: () =>
      call(api.GET('/api/retainers/{id}/billing', { params: { path: { id: retainerId } } })),
  });

/** The issued invoice's PDF, or the draft's preview; served inline, never cached. */
export const invoicePdfUrl = (id: string, draft = false) =>
  `/api/invoices/${id}/pdf${draft ? '?draft=true' : ''}`;

/** A payment's receipt PDF (rule 20). */
export const receiptPdfUrl = (paymentId: string) => `/api/payments/${paymentId}/receipt`;

/**
 * The changed invoice and every invoice list. Issuing, voiding and payments also change what
 * other screens show: extra work billing (rules 11 and 14), the engagements' billing, the client's
 * documents (PDFs, receipts, proofs) and the calendar's due dates.
 */
function useSaveInvoice({ wide }: { wide: boolean }) {
  const queryClient = useQueryClient();
  return (invoice: InvoiceDetail) => {
    queryClient.setQueryData(invoicesKeys.detail(invoice.id), invoice);
    const keys: QueryKey[] = [invoicesKeys.all];
    if (wide) {
      keys.push(
        projectsKeys.all,
        retainersKeys.all,
        clientsKeys.all,
        filesKeys.all,
        calendarKeys.all,
      );
    }
    return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  };
}

export function useCreateInvoice() {
  const save = useSaveInvoice({ wide: true });
  return useMutation({
    mutationFn: (input: CreateInvoice) => call(api.POST('/api/invoices', { body: input })),
    onSuccess: save,
  });
}

export function useSaveInvoiceDraft(id: string) {
  const save = useSaveInvoice({ wide: true });
  return useMutation({
    mutationFn: (input: InvoiceDraft) =>
      call(api.PUT('/api/invoices/{id}', { params: { path: { id } }, body: input })),
    onSuccess: save,
  });
}

export function useIssueInvoice(id: string) {
  const save = useSaveInvoice({ wide: true });
  return useMutation({
    mutationFn: (input: IssueInvoice) =>
      call(api.POST('/api/invoices/{id}/issue', { params: { path: { id } }, body: input })),
    onSuccess: save,
  });
}

export function useChangeDueDate(id: string) {
  const save = useSaveInvoice({ wide: true });
  return useMutation({
    mutationFn: (input: ChangeInvoiceDueDate) =>
      call(api.POST('/api/invoices/{id}/due-date', { params: { path: { id } }, body: input })),
    onSuccess: save,
  });
}

export function useVoidInvoice(id: string) {
  const save = useSaveInvoice({ wide: true });
  return useMutation({
    mutationFn: (input: VoidInvoice) =>
      call(api.POST('/api/invoices/{id}/void', { params: { path: { id } }, body: input })),
    onSuccess: save,
  });
}

/** Rule 8: discarding a draft releases its sources, so the engagements' billing changes too. */
export function useArchiveInvoice(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => call(api.POST('/api/invoices/{id}/archive', { params: { path: { id } } })),
    onSuccess: () =>
      Promise.all(
        [invoicesKeys.all, projectsKeys.all, retainersKeys.all, clientsKeys.all].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

export function useRecordPayment(id: string) {
  const save = useSaveInvoice({ wide: true });
  return useMutation({
    mutationFn: (input: RecordPayment) =>
      call(api.POST('/api/invoices/{id}/payments', { params: { path: { id } }, body: input })),
    onSuccess: save,
  });
}

export function useVoidPayment() {
  const save = useSaveInvoice({ wide: true });
  return useMutation({
    mutationFn: ({ paymentId, ...input }: VoidPayment & { paymentId: string }) =>
      call(
        api.POST('/api/payments/{id}/void', { params: { path: { id: paymentId } }, body: input }),
      ),
    onSuccess: save,
  });
}

/** Queues the draft preview or renders an issued invoice again; the detail then follows the state. */
export function useRenderInvoicePdf(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => call(api.POST('/api/invoices/{id}/pdf', { params: { path: { id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invoicesKeys.detail(id) }),
  });
}

/** Renders a receipt again after a failure. */
export function useRenderReceipt(invoiceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: string) =>
      call(api.POST('/api/payments/{id}/receipt', { params: { path: { id: paymentId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invoicesKeys.detail(invoiceId) }),
  });
}

/** A statement's PDF (rule 29), downloadable for 24 hours once it is ready. */
export function statementPdfUrl(clientId: string, query: ClientStatementQuery) {
  const params = new URLSearchParams({ currency: query.currency });
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  return `/api/clients/${clientId}/statement/pdf?${params}`;
}

/** How many times a statement being rendered is looked for before the page gives up (2 minutes). */
const STATEMENT_PDF_TRIES = 40;

/**
 * Resolves once the asked-for statement PDF can be downloaded: the download answers 404 until the
 * worker has rendered it, so a `HEAD` request tells without fetching the file. Only that 404 is
 * retried, up to `STATEMENT_PDF_TRIES` times; any other failure is an `ApiError` the app's error
 * handling sees at once (a 401 signs out, a 403 reloads the user's access).
 */
export const statementPdfReadyQuery = (clientId: string, query: ClientStatementQuery) =>
  queryOptions({
    queryKey: invoicesKeys.statementPdf(clientId, query),
    queryFn: async () => {
      const response = await fetch(statementPdfUrl(clientId, query), { method: 'HEAD' });
      if (!response.ok) {
        throw new ApiError(response.status, undefined, undefined, response.statusText);
      }
      return true;
    },
    retry: (failures, error) =>
      error instanceof ApiError && error.status === 404 && failures < STATEMENT_PDF_TRIES,
    retryDelay: PDF_POLL_MS,
    gcTime: 0,
  });

/** Asks for the statement's PDF as it is now; `pending` until the worker has rendered it. */
export function useRenderStatement(clientId: string) {
  return useMutation({
    mutationFn: (query: ClientStatementQuery) =>
      call(
        api.POST('/api/clients/{id}/statement/pdf', {
          params: { path: { id: clientId }, query },
        }),
      ),
  });
}

/** Expense changes answer with the project's whole billing (rules 26 and 27), cached as is. */
function useSaveProjectBilling(projectId: string) {
  const queryClient = useQueryClient();
  return (billing: ProjectBilling) =>
    queryClient.setQueryData(invoicesKeys.projectBilling(projectId), billing);
}

export function useCreateExpense(projectId: string) {
  const save = useSaveProjectBilling(projectId);
  return useMutation({
    mutationFn: (input: CreateProjectExpense) =>
      call(
        api.POST('/api/projects/{id}/expenses', {
          params: { path: { id: projectId } },
          body: input,
        }),
      ),
    onSuccess: save,
  });
}

export function useUpdateExpense(projectId: string) {
  const save = useSaveProjectBilling(projectId);
  return useMutation({
    mutationFn: ({ expenseId, ...input }: UpdateProjectExpense & { expenseId: string }) =>
      call(
        api.PATCH('/api/project-expenses/{id}', {
          params: { path: { id: expenseId } },
          body: input,
        }),
      ),
    onSuccess: save,
  });
}

export function useArchiveExpense(projectId: string) {
  const save = useSaveProjectBilling(projectId);
  return useMutation({
    mutationFn: (expenseId: string) =>
      call(api.POST('/api/project-expenses/{id}/archive', { params: { path: { id: expenseId } } })),
    onSuccess: save,
  });
}

export function useUpdateInvoiceSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateInvoiceSettings) =>
      call(api.PATCH('/api/invoice-settings', { body: input })),
    onSuccess: (settings) => queryClient.setQueryData(invoicesKeys.settings, settings),
  });
}
