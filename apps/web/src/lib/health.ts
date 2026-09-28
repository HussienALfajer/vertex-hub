import { queryOptions } from '@tanstack/react-query';
import type { HealthResponse } from '@vertex-hub/contracts';
import { ApiError, api } from './api/client';

async function fetchHealth(): Promise<HealthResponse> {
  const { data, error, response } = await api.GET('/api/health');
  if (data) return data;
  // 503 still carries a health body describing which dependency is down.
  if (response.status === 503 && error) return error as HealthResponse;
  throw new ApiError(response.status, undefined, undefined, `HTTP ${response.status}`);
}

export const healthQuery = queryOptions({
  queryKey: ['health'],
  queryFn: fetchHealth,
  refetchInterval: 30_000,
  retry: false,
});
