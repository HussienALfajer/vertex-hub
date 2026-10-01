import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateApprovalRequest, PublicResponse } from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';

/** The list endpoint's query string as the API reads it. */
export type ApprovalRequestFilters = NonNullable<
  paths['/api/approvals/requests']['get']['parameters']['query']
>;

export const approvalsKeys = {
  all: ['approvals'] as const,
  ready: (clientId?: string) => ['approvals', 'ready', clientId ?? null] as const,
  requests: (filters: ApprovalRequestFilters) => ['approvals', 'requests', filters] as const,
  request: (id: string) => ['approvals', 'request', id] as const,
  client: (clientId: string, page: number) => ['approvals', 'client', clientId, page] as const,
  public: (token: string) => ['approvals', 'public', token] as const,
};

/**
 * The tasks ready to send to a client, under the caller's client scope (F09 rule 8): every
 * client's, or one client's.
 */
export const approvalReadyQuery = (clientId?: string) =>
  queryOptions({
    queryKey: approvalsKeys.ready(clientId),
    queryFn: () => call(api.GET('/api/approvals/ready', { params: { query: { clientId } } })),
  });

export const approvalRequestListQuery = (filters: ApprovalRequestFilters) =>
  queryOptions({
    queryKey: approvalsKeys.requests(filters),
    queryFn: () => call(api.GET('/api/approvals/requests', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const approvalRequestQuery = (id: string) =>
  queryOptions({
    queryKey: approvalsKeys.request(id),
    queryFn: () => call(api.GET('/api/approvals/requests/{id}', { params: { path: { id } } })),
  });

export const CLIENT_APPROVALS_PAGE_SIZE = 20;

/** A client's requests and its responses, newest first; both lists take the same page. */
export const clientApprovalsQuery = (clientId: string, page: number) =>
  queryOptions({
    queryKey: approvalsKeys.client(clientId, page),
    queryFn: () =>
      call(
        api.GET('/api/clients/{id}/approvals', {
          params: { path: { id: clientId }, query: { page, pageSize: CLIENT_APPROVALS_PAGE_SIZE } },
        }),
      ),
    placeholderData: keepPreviousData,
  });

/**
 * A change to an approval request, refreshing also on failure (a request closed meanwhile shows
 * its current state): approvals, and tasks, which show their pending link and whether they are
 * ready to send.
 */
function useApprovalsMutation<Input, Output>(mutationFn: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      Promise.all(
        [approvalsKeys.all, ['tasks']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

const path = (id: string) => ({ params: { path: { id } } });

/** The answer carries the link, shown once (rule 9). */
export const useCreateApprovalRequest = () =>
  useApprovalsMutation((input: CreateApprovalRequest) =>
    call(api.POST('/api/approvals/requests', { body: input })),
  );

/** A new link for the same request; the old one stops working (rule 11). */
export const useReissueApprovalRequest = (id: string) =>
  useApprovalsMutation(() => call(api.POST('/api/approvals/requests/{id}/reissue', path(id))));

export const useRevokeApprovalRequest = (id: string) =>
  useApprovalsMutation(() => call(api.POST('/api/approvals/requests/{id}/revoke', path(id))));

// The client page: no session, the token is the access (rules 20–23).

export const publicApprovalQuery = (token: string) =>
  queryOptions({
    queryKey: approvalsKeys.public(token),
    queryFn: () => call(api.GET('/api/public/approvals/{token}', { params: { path: { token } } })),
    // An invalid or expired link stays so: retrying only delays its message.
    retry: false,
  });

/** The client's decision on one item; the page reloads either way (another item may have moved). */
export function useRespondToApproval(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, ...input }: PublicResponse & { itemId: string }) =>
      call(
        api.POST('/api/public/approvals/{token}/items/{itemId}/response', {
          params: { path: { token, itemId } },
          body: input,
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: approvalsKeys.public(token) }),
  });
}

/** The bytes of a snapshot version of the link; the API checks the token on each request. */
export const publicVersionUrl = (
  token: string,
  versionId: string,
  part: 'content' | 'preview' | 'thumbnail',
) => `/api/public/approvals/${encodeURIComponent(token)}/versions/${versionId}/${part}`;
