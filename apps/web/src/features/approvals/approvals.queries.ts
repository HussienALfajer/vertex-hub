import { queryOptions } from '@tanstack/react-query';
import { api, call } from '../../lib/api/client';

export const approvalsKeys = {
  all: ['approvals'] as const,
  ready: ['approvals', 'ready'] as const,
};

/** The tasks ready to send to a client, under the caller's client scope (F09 rule 8). */
export const approvalReadyQuery = queryOptions({
  queryKey: approvalsKeys.ready,
  queryFn: () => call(api.GET('/api/approvals/ready')),
});
