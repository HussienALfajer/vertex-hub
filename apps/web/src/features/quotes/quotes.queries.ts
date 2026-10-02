import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreateQuote,
  QuoteApprovalAction,
  QuoteApprovalDecision,
  QuoteDetail,
  QuoteDraft,
  RejectQuote,
  UpdateQuoteSettings,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';

/** The list endpoint's query string as the API reads it: flags are `'true'` or `'false'`. */
export type QuoteListFilters = NonNullable<paths['/api/quotes']['get']['parameters']['query']>;

export const quotesKeys = {
  all: ['quotes'] as const,
  list: (filters: QuoteListFilters) => ['quotes', 'list', filters] as const,
  detail: (id: string) => ['quotes', 'detail', id] as const,
  settings: ['quotes', 'settings'] as const,
};

/** How often a quote whose PDF is being rendered asks again (rules 12 and 13). */
const PDF_POLL_MS = 3000;

export const quoteListQuery = (filters: QuoteListFilters) =>
  queryOptions({
    queryKey: quotesKeys.list(filters),
    queryFn: () => call(api.GET('/api/quotes', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const quoteQuery = (id: string) =>
  queryOptions({
    queryKey: quotesKeys.detail(id),
    queryFn: () => call(api.GET('/api/quotes/{id}', { params: { path: { id } } })),
    refetchInterval: (query) => {
      const quote = query.state.data;
      const rendering = quote?.pdf?.state === 'pending' || quote?.draftPdf?.state === 'pending';
      return rendering ? PDF_POLL_MS : false;
    },
  });

export const quoteSettingsQuery = queryOptions({
  queryKey: quotesKeys.settings,
  queryFn: () => call(api.GET('/api/quote-settings')),
});

/** The PDF of a sent version, or the draft's preview; served inline, never cached. */
export const quotePdfUrl = (id: string, draft = false) =>
  `/api/quotes/${id}/pdf${draft ? '?draft=true' : ''}`;

/** Every quote list and the changed quote: lists show statuses, nets and approvals. */
function useSaveQuote() {
  const queryClient = useQueryClient();
  return (quote: QuoteDetail) => {
    queryClient.setQueryData(quotesKeys.detail(quote.id), quote);
    return queryClient.invalidateQueries({ queryKey: quotesKeys.all });
  };
}

export function useCreateQuote() {
  const save = useSaveQuote();
  return useMutation({
    mutationFn: (input: CreateQuote) => call(api.POST('/api/quotes', { body: input })),
    onSuccess: save,
  });
}

export function useSaveDraft(id: string) {
  const save = useSaveQuote();
  return useMutation({
    mutationFn: (input: QuoteDraft) =>
      call(api.PUT('/api/quotes/{id}', { params: { path: { id } }, body: input })),
    onSuccess: save,
  });
}

export function useQuoteApproval(id: string) {
  const save = useSaveQuote();
  return useMutation({
    mutationFn: (input: QuoteApprovalAction) =>
      call(api.POST('/api/quotes/{id}/approval', { params: { path: { id } }, body: input })),
    onSuccess: save,
  });
}

export function useDecideApproval(id: string) {
  const save = useSaveQuote();
  return useMutation({
    mutationFn: (input: QuoteApprovalDecision) =>
      call(
        api.POST('/api/quotes/{id}/approval/decision', {
          params: { path: { id } },
          body: input,
        }),
      ),
    onSuccess: save,
  });
}

export function useSendQuote(id: string) {
  const save = useSaveQuote();
  return useMutation({
    mutationFn: (confirmZeroPrice: boolean) =>
      call(
        api.POST('/api/quotes/{id}/send', { params: { path: { id } }, body: { confirmZeroPrice } }),
      ),
    onSuccess: save,
  });
}

export function useExtendQuote(id: string) {
  const save = useSaveQuote();
  return useMutation({
    mutationFn: (validUntil: string) =>
      call(api.POST('/api/quotes/{id}/extend', { params: { path: { id } }, body: { validUntil } })),
    onSuccess: save,
  });
}

export function useRejectQuote(id: string) {
  const save = useSaveQuote();
  return useMutation({
    mutationFn: (input: RejectQuote) =>
      call(api.POST('/api/quotes/{id}/reject', { params: { path: { id } }, body: input })),
    onSuccess: save,
  });
}

export function useCreateVersion(id: string) {
  const save = useSaveQuote();
  return useMutation({
    mutationFn: () => call(api.POST('/api/quotes/{id}/versions', { params: { path: { id } } })),
    onSuccess: save,
  });
}

export function useArchiveQuote(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => call(api.POST('/api/quotes/{id}/archive', { params: { path: { id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: quotesKeys.all }),
  });
}

/** Queues the draft preview or renders a sent version again; the detail then follows the state. */
export function useRenderPdf(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => call(api.POST('/api/quotes/{id}/pdf', { params: { path: { id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: quotesKeys.detail(id) }),
  });
}

export function useUpdateQuoteSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateQuoteSettings) =>
      call(api.PATCH('/api/quote-settings', { body: input })),
    onSuccess: (settings) => queryClient.setQueryData(quotesKeys.settings, settings),
  });
}
