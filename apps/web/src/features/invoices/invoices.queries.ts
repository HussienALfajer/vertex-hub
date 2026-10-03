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
  CreateInvoice,
  InvoiceDetail,
  InvoiceDraft,
  IssueInvoice,
  RecordPayment,
  UpdateInvoiceSettings,
  VoidInvoice,
  VoidPayment,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
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

export function useUpdateInvoiceSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateInvoiceSettings) =>
      call(api.PATCH('/api/invoice-settings', { body: input })),
    onSuccess: (settings) => queryClient.setQueryData(invoicesKeys.settings, settings),
  });
}
