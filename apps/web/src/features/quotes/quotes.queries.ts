import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AcceptQuote,
  CreateQuote,
  QuoteApprovalAction,
  QuoteApprovalDecision,
  QuoteDetail,
  QuoteDraft,
  RejectQuote,
  UpdateQuoteSettings,
} from '@vertex-hub/contracts';
import { useCallback } from 'react';
import { ApiError, api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';
import { filesKeys } from '../files/files.queries';
import { projectsKeys } from '../projects/projects.queries';
import { retainersKeys } from '../retainers/retainers.queries';
import { tasksKeys } from '../tasks/tasks.queries';
import { templatesKeys } from '../templates/templates.queries';

/** The list endpoint's query string as the API reads it: flags are `'true'` or `'false'`. */
export type QuoteListFilters = NonNullable<paths['/api/quotes']['get']['parameters']['query']>;

/** The accept dialog's current choices, as the plan endpoint reads them (A2–A5). */
export type AcceptPlanFilters = NonNullable<
  paths['/api/quotes/{id}/accept-plan']['get']['parameters']['query']
>;

export const quotesKeys = {
  all: ['quotes'] as const,
  list: (filters: QuoteListFilters) => ['quotes', 'list', filters] as const,
  detail: (id: string) => ['quotes', 'detail', id] as const,
  settings: ['quotes', 'settings'] as const,
  acceptPlan: (id: string, filters: AcceptPlanFilters) =>
    ['quotes', 'accept-plan', id, filters] as const,
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

export const acceptPlanQuery = (id: string, filters: AcceptPlanFilters) =>
  queryOptions({
    queryKey: quotesKeys.acceptPlan(id, filters),
    queryFn: () =>
      call(api.GET('/api/quotes/{id}/accept-plan', { params: { path: { id }, query: filters } })),
    // A changed choice keeps the dialog filled while the new plan loads.
    placeholderData: keepPreviousData,
  });

export const quoteSettingsQuery = queryOptions({
  queryKey: quotesKeys.settings,
  queryFn: () => call(api.GET('/api/quote-settings')),
});

/** The PDF of a sent version, or the draft's preview; served inline, never cached. */
export const quotePdfUrl = (id: string, draft = false) =>
  `/api/quotes/${id}/pdf${draft ? '?draft=true' : ''}`;

/**
 * Every quote list and the changed quote: lists show statuses, nets and approvals. Accept plans
 * are left alone: an open accept dialog would ask again for a quote it just accepted.
 */
function useSaveQuote() {
  const queryClient = useQueryClient();
  return (quote: QuoteDetail) => {
    queryClient.setQueryData(quotesKeys.detail(quote.id), quote);
    return queryClient.invalidateQueries({
      queryKey: quotesKeys.all,
      predicate: (query) => query.queryKey[1] !== 'accept-plan',
    });
  };
}

/**
 * The quote changed under the dialog (expired, or accepted by someone else; edge cases 5 and 7):
 * its page reloads, so it offers what is left, such as "Extend validity".
 */
export function useRefreshAfterRefusal(id: string) {
  const queryClient = useQueryClient();
  return useCallback(
    (error: unknown) => {
      const code = error instanceof ApiError ? error.code : undefined;
      if (code === 'QUOTE_EXPIRED' || code === 'INVALID_TRANSITION') {
        void queryClient.invalidateQueries({ queryKey: quotesKeys.detail(id) });
      }
    },
    [queryClient, id],
  );
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

/**
 * A01: records the acceptance and creates or renews the engagements, their tasks and the proof
 * document in one go, so every list they appear in is refreshed.
 */
export function useAcceptQuote(id: string) {
  const save = useSaveQuote();
  const refresh = useRefreshAfterRefusal(id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AcceptQuote) =>
      call(api.POST('/api/quotes/{id}/accept', { params: { path: { id } }, body: input })),
    onSuccess: async (quote) => {
      await Promise.all(
        [projectsKeys.all, retainersKeys.all, tasksKeys.all, templatesKeys.all, filesKeys.all].map(
          (queryKey) => queryClient.invalidateQueries({ queryKey }),
        ),
      );
      return save(quote);
    },
    onError: refresh,
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
