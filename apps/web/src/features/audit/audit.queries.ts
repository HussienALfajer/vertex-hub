import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { AuditListQuery } from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';

export type AuditFilters = Partial<AuditListQuery>;

export const auditListQuery = (filters: AuditFilters) =>
  queryOptions({
    queryKey: ['audit', 'list', filters] as const,
    queryFn: () => call(api.GET('/api/audit', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });
