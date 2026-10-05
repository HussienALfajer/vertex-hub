import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ClientEmail, ClientStatementQuery, EmailSummary } from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';

/** The email log's query string as the API reads it (F14 email screen 6). */
export type EmailListFilters = NonNullable<paths['/api/emails']['get']['parameters']['query']>;

/** A document whose emails the history shows (screen 5). */
export type EmailHistoryTarget =
  | { type: 'quote'; id: string }
  | { type: 'invoice'; id: string }
  | { type: 'approval_request'; id: string }
  | { type: 'statement'; clientId: string }
  | { type: 'report'; clientId: string; month: string }
  | { type: 'ad_wallet'; clientId: string };

/** The route a "Send by email" dialog posts to, with what it adds to the email (rule 18). */
export type ClientEmailTarget =
  | { type: 'quote'; id: string; kind: 'quote' | 'reminder' }
  | { type: 'invoice'; id: string; kind: 'invoice' | 'overdue_reminder' }
  | { type: 'payment'; id: string }
  | ({ type: 'statement'; clientId: string } & ClientStatementQuery)
  | { type: 'report'; clientId: string; month: string }
  | { type: 'ad_receipt'; id: string }
  | { type: 'ad_budget'; clientId: string };

export const emailKeys = {
  all: ['emails'] as const,
  list: (filters: EmailListFilters) => ['emails', 'list', filters] as const,
  history: (target: EmailHistoryTarget) => ['emails', 'history', target] as const,
};

export const emailListQuery = (filters: EmailListFilters) =>
  queryOptions({
    queryKey: emailKeys.list(filters),
    queryFn: () => call(api.GET('/api/emails', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

function fetchHistory(target: EmailHistoryTarget) {
  switch (target.type) {
    case 'quote':
      return call(api.GET('/api/quotes/{id}/emails', { params: { path: { id: target.id } } }));
    case 'invoice':
      return call(api.GET('/api/invoices/{id}/emails', { params: { path: { id: target.id } } }));
    case 'approval_request':
      return call(
        api.GET('/api/approvals/requests/{id}/emails', { params: { path: { id: target.id } } }),
      );
    case 'statement':
      return call(
        api.GET('/api/clients/{id}/statement/emails', {
          params: { path: { id: target.clientId } },
        }),
      );
    case 'report':
      return call(
        api.GET('/api/clients/{id}/monthly-report/emails', {
          params: { path: { id: target.clientId }, query: { month: target.month } },
        }),
      );
    case 'ad_wallet':
      return call(
        api.GET('/api/clients/{id}/ad-wallet/emails', {
          params: { path: { id: target.clientId } },
        }),
      );
  }
}

export const emailHistoryQuery = (target: EmailHistoryTarget) =>
  queryOptions({ queryKey: emailKeys.history(target), queryFn: () => fetchHistory(target) });

function postEmail(target: ClientEmailTarget, email: ClientEmail): Promise<EmailSummary> {
  switch (target.type) {
    case 'quote':
      return call(
        api.POST('/api/quotes/{id}/email', {
          params: { path: { id: target.id } },
          body: { ...email, kind: target.kind },
        }),
      );
    case 'invoice':
      return call(
        api.POST('/api/invoices/{id}/email', {
          params: { path: { id: target.id } },
          body: { ...email, kind: target.kind },
        }),
      );
    case 'payment':
      return call(
        api.POST('/api/payments/{id}/email', { params: { path: { id: target.id } }, body: email }),
      );
    case 'statement':
      return call(
        api.POST('/api/clients/{id}/statement/email', {
          params: { path: { id: target.clientId } },
          body: { ...email, currency: target.currency, from: target.from, to: target.to },
        }),
      );
    case 'report':
      return call(
        api.POST('/api/clients/{id}/monthly-report/email', {
          params: { path: { id: target.clientId } },
          body: { ...email, month: target.month },
        }),
      );
    case 'ad_receipt':
      return call(
        api.POST('/api/ad-wallet-entries/{id}/email', {
          params: { path: { id: target.id } },
          body: email,
        }),
      );
    case 'ad_budget':
      return call(
        api.POST('/api/clients/{id}/ad-wallet/email', {
          params: { path: { id: target.clientId } },
          body: email,
        }),
      );
  }
}

/** Rule 22: the email shows in the document's history and the record's audit entries. */
export function useSendClientEmail(target: ClientEmailTarget) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (email: ClientEmail) => postEmail(target, email),
    onSuccess: () =>
      Promise.all(
        [emailKeys.all, ['audit']].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ),
  });
}

/** Rule 26: a test email to the administrator's own address. */
export function useSendTestEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => call(api.POST('/api/emails/test')),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: emailKeys.all }),
  });
}
