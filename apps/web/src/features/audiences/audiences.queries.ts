import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { Audience } from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';

export const audiencesKeys = {
  preview: (audience: Audience) => ['audiences', 'preview', audience] as const,
};

/** Rule D2: the live count and the names of an audience, refreshed as the picker changes. */
export const audiencePreviewQuery = (audience: Audience) =>
  queryOptions({
    queryKey: audiencesKeys.preview(audience),
    queryFn: () => call(api.POST('/api/audiences/preview', { body: audience })),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
