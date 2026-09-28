import { queryOptions } from '@tanstack/react-query';
import { type HealthResponse, healthResponseSchema } from '@vertex-hub/contracts';

// Temporary hand-written call; replaced by the OpenAPI-generated client (ADR 0003) with the first feature.
async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health');
  // 503 still carries a health body describing which dependency is down.
  if (!response.ok && response.status !== 503) {
    throw new Error(`Health check failed with HTTP ${response.status}`);
  }
  return healthResponseSchema.parse(await response.json());
}

export const healthQuery = queryOptions({
  queryKey: ['health'],
  queryFn: fetchHealth,
  refetchInterval: 30_000,
  retry: false,
});
