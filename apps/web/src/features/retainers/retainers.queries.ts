import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CreateCycleAdjustment,
  CreateCycleLine,
  CreateRetainer,
  RetainerDeliverables,
  RetainerStatusChange,
  UpdateCycleLine,
  UpdateRetainer,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';

/** The list endpoint's query string as the API reads it: flags are `'true'` or `'false'`. */
export type RetainerListFilters = NonNullable<
  paths['/api/retainers']['get']['parameters']['query']
>;

export const retainersKeys = {
  all: ['retainers'] as const,
  list: (filters: RetainerListFilters) => ['retainers', 'list', filters] as const,
  detail: (id: string) => ['retainers', 'detail', id] as const,
  cycles: (id: string) => ['retainers', 'cycles', id] as const,
  cycle: (id: string, cycleId: string) => ['retainers', 'cycle', id, cycleId] as const,
  extraWork: (id: string) => ['retainers', 'extra-work', id] as const,
};

export const retainerListQuery = (filters: RetainerListFilters) =>
  queryOptions({
    queryKey: retainersKeys.list(filters),
    queryFn: () => call(api.GET('/api/retainers', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const retainerQuery = (id: string) =>
  queryOptions({
    queryKey: retainersKeys.detail(id),
    queryFn: () => call(api.GET('/api/retainers/{id}', { params: { path: { id } } })),
  });

const CYCLE_PAGE_SIZE = 12;

/** A retainer's cycles, newest month first, a year at a time ("Show older"). */
export const retainerCyclesQuery = (id: string) =>
  infiniteQueryOptions({
    queryKey: retainersKeys.cycles(id),
    queryFn: ({ pageParam }) =>
      call(
        api.GET('/api/retainers/{id}/cycles', {
          params: { path: { id }, query: { page: pageParam, pageSize: CYCLE_PAGE_SIZE } },
        }),
      ),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });

/** One cycle with each line's adjustments. */
export const retainerCycleQuery = (id: string, cycleId: string) =>
  queryOptions({
    queryKey: retainersKeys.cycle(id, cycleId),
    queryFn: () =>
      call(
        api.GET('/api/retainers/{id}/cycles/{cycleId}', {
          params: { path: { id, cycleId } },
        }),
      ),
  });

/**
 * A mutation on retainer data. Every one refreshes the whole `retainers` cache, also on failure:
 * a 403 after the client changed account manager (edge case 9) reloads the page without edit
 * actions. Committed quantities and status also drive the monthly template's line counts (F07),
 * and archiving or reopening a month hides or generates tasks, so task views refresh too.
 */
function useRetainersMutation<Input, Output>(mutationFn: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: retainersKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['templates', 'retainer'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ]),
  });
}

const path = (id: string) => ({ params: { path: { id } } });

export const useCreateRetainer = () =>
  useRetainersMutation((input: CreateRetainer) =>
    call(api.POST('/api/retainers', { body: input })),
  );

export const useUpdateRetainer = (id: string) =>
  useRetainersMutation((input: UpdateRetainer) =>
    call(api.PATCH('/api/retainers/{id}', { ...path(id), body: input })),
  );

export const useUpdateDeliverables = (id: string) =>
  useRetainersMutation((input: RetainerDeliverables) =>
    call(api.PUT('/api/retainers/{id}/deliverables', { ...path(id), body: input })),
  );

export const useChangeRetainerStatus = (id: string) =>
  useRetainersMutation((input: RetainerStatusChange) =>
    call(api.POST('/api/retainers/{id}/status', { ...path(id), body: input })),
  );

export const useArchiveRetainer = (id: string) =>
  useRetainersMutation(() => call(api.POST('/api/retainers/{id}/archive', path(id))));

export const useRestoreRetainer = (id: string) =>
  useRetainersMutation(() => call(api.POST('/api/retainers/{id}/restore', path(id))));

export const useUpdateCycleLine = (id: string, cycleId: string) =>
  useRetainersMutation(({ lineId, ...input }: UpdateCycleLine & { lineId: string }) =>
    call(
      api.PATCH('/api/retainers/{id}/cycles/{cycleId}/lines/{lineId}', {
        params: { path: { id, cycleId, lineId } },
        body: input,
      }),
    ),
  );

export const useAddCycleLine = (id: string, cycleId: string) =>
  useRetainersMutation((input: CreateCycleLine) =>
    call(
      api.POST('/api/retainers/{id}/cycles/{cycleId}/lines', {
        params: { path: { id, cycleId } },
        body: input,
      }),
    ),
  );

export const useAdjustCycleLine = (id: string, cycleId: string) =>
  useRetainersMutation(({ lineId, ...input }: CreateCycleAdjustment & { lineId: string }) =>
    call(
      api.POST('/api/retainers/{id}/cycles/{cycleId}/lines/{lineId}/adjustments', {
        params: { path: { id, cycleId, lineId } },
        body: input,
      }),
    ),
  );
