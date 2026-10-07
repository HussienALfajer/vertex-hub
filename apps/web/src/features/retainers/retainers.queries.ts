import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  ApproveAmendment,
  CancelRetainerTerm,
  CreateAmendment,
  CreateCycleAdjustment,
  CreateCycleLine,
  CreateRetainer,
  CreateRetainerTerm,
  RejectAmendment,
  RescheduleTerm,
  RetainerDeliverables,
  RetainerStatusChange,
  UpdateCycleLine,
  UpdateRetainer,
  UpdateRetainerTerm,
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
  terms: (id: string) => ['retainers', 'terms', id] as const,
  amendments: (id: string) => ['retainers', 'amendments', id] as const,
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

/** The retainer's terms, newest first (F05B). */
export const retainerTermsQuery = (id: string) =>
  queryOptions({
    queryKey: retainersKeys.terms(id),
    queryFn: () => call(api.GET('/api/retainers/{retainerId}/terms', retainerPath(id))),
  });

/** The retainer's amendments, newest first (F05B); at most 300 per retainer (A7). */
export const retainerAmendmentsQuery = (id: string) =>
  queryOptions({
    queryKey: retainersKeys.amendments(id),
    queryFn: () =>
      call(
        api.GET('/api/retainers/{retainerId}/amendments', {
          params: { path: { retainerId: id }, query: { page: 1, pageSize: 100 } },
        }),
      ),
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
 * and archiving or reopening a month hides or generates tasks, so task views refresh too. Terms,
 * starting a month and ending with a fee draft invoices (F05B C4), so invoice views refresh too.
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
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
      ]),
  });
}

const path = (id: string) => ({ params: { path: { id } } });

const retainerPath = (retainerId: string) => ({ params: { path: { retainerId } } });

const termPath = (retainerId: string, termId: string) => ({
  params: { path: { retainerId, termId } },
});

export const useCreateTerm = (retainerId: string) =>
  useRetainersMutation((input: CreateRetainerTerm) =>
    call(
      api.POST('/api/retainers/{retainerId}/terms', { ...retainerPath(retainerId), body: input }),
    ),
  );

export const useUpdateTerm = (retainerId: string) =>
  useRetainersMutation(({ termId, ...input }: UpdateRetainerTerm & { termId: string }) =>
    call(
      api.PATCH('/api/retainers/{retainerId}/terms/{termId}', {
        ...termPath(retainerId, termId),
        body: input,
      }),
    ),
  );

export const useCancelTerm = (retainerId: string) =>
  useRetainersMutation(({ termId, ...input }: CancelRetainerTerm & { termId: string }) =>
    call(
      api.POST('/api/retainers/{retainerId}/terms/{termId}/cancel', {
        ...termPath(retainerId, termId),
        body: input,
      }),
    ),
  );

/** F05B A1–A5: the amendment saved, applied, scheduled or waiting for approval. */
export const useCreateAmendment = (retainerId: string) =>
  useRetainersMutation((input: CreateAmendment) =>
    call(
      api.POST('/api/retainers/{retainerId}/amendments', {
        ...retainerPath(retainerId),
        body: input,
      }),
    ),
  );

/** What saving an amendment would do; nothing is saved, so nothing is refreshed. */
export const usePreviewAmendment = (retainerId: string) =>
  useMutation({
    mutationFn: (input: CreateAmendment) =>
      call(
        api.POST('/api/retainers/{retainerId}/amendments/preview', {
          ...retainerPath(retainerId),
          body: input,
        }),
      ),
  });

const amendmentPath = (retainerId: string, amendmentId: string) => ({
  params: { path: { retainerId, amendmentId } },
});

/** A4: the General Manager approves or rejects; the creator or a manager withdraws. */
export const useDecideAmendment = (retainerId: string) =>
  useRetainersMutation(
    (
      input:
        | ({ action: 'approve'; amendmentId: string } & ApproveAmendment)
        | ({ action: 'reject'; amendmentId: string } & RejectAmendment)
        | { action: 'withdraw'; amendmentId: string },
    ) => {
      const where = amendmentPath(retainerId, input.amendmentId);
      if (input.action === 'withdraw') {
        return call(
          api.POST('/api/retainers/{retainerId}/amendments/{amendmentId}/withdraw', where),
        );
      }
      if (input.action === 'reject') {
        return call(
          api.POST('/api/retainers/{retainerId}/amendments/{amendmentId}/reject', {
            ...where,
            body: { note: input.note },
          }),
        );
      }
      return call(
        api.POST('/api/retainers/{retainerId}/amendments/{amendmentId}/approve', {
          ...where,
          body: { note: input.note },
        }),
      );
    },
  );

/** A6: new amounts for unbilled months of a term, same total. */
export const useRescheduleTerm = (retainerId: string) =>
  useRetainersMutation(({ termId, ...input }: RescheduleTerm & { termId: string }) =>
    call(
      api.POST('/api/retainers/{retainerId}/terms/{termId}/reschedule', {
        ...termPath(retainerId, termId),
        body: input,
      }),
    ),
  );

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
