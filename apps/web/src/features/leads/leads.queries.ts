import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ConvertLead,
  CreateLead,
  CreateLeadNote,
  LeadDuplicateQuery,
  LeadStageChange,
  LoseLead,
  ReopenLead,
  UpdateLead,
  UpdateLeadNote,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';

/** The list endpoint's query string as the API reads it: flags are `'true'` or `'false'`. */
export type LeadListFilters = NonNullable<paths['/api/leads']['get']['parameters']['query']>;

export type LeadBoardFilters = NonNullable<paths['/api/leads/board']['get']['parameters']['query']>;

export const leadsKeys = {
  all: ['leads'] as const,
  list: (filters: LeadListFilters) => ['leads', 'list', filters] as const,
  board: (filters: LeadBoardFilters) => ['leads', 'board', filters] as const,
  detail: (id: string) => ['leads', 'detail', id] as const,
  owners: ['leads', 'owners'] as const,
  interestOptions: ['leads', 'interest-options'] as const,
  duplicates: (query: LeadDuplicateQuery) => ['leads', 'duplicates', query] as const,
  conversionPlan: (id: string, clientId: string | undefined) =>
    ['leads', 'conversion-plan', id, clientId ?? null] as const,
};

export const leadListQuery = (filters: LeadListFilters) =>
  queryOptions({
    queryKey: leadsKeys.list(filters),
    queryFn: () => call(api.GET('/api/leads', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const leadBoardQuery = (filters: LeadBoardFilters) =>
  queryOptions({
    queryKey: leadsKeys.board(filters),
    queryFn: () => call(api.GET('/api/leads/board', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const leadQuery = (id: string) =>
  queryOptions({
    queryKey: leadsKeys.detail(id),
    queryFn: () => call(api.GET('/api/leads/{id}', { params: { path: { id } } })),
  });

/** Users who may own leads (rule 1). */
export const leadOwnersQuery = queryOptions({
  queryKey: leadsKeys.owners,
  queryFn: () => call(api.GET('/api/leads/owners')),
  staleTime: 60_000,
});

/** The interest picker's services and packages, by name. */
export const interestOptionsQuery = queryOptions({
  queryKey: leadsKeys.interestOptions,
  queryFn: () => call(api.GET('/api/leads/interest-options')),
  staleTime: 5 * 60_000,
});

/** Rule 2: a read sent as POST, so phones and emails stay out of URLs. */
export const leadDuplicatesQuery = (query: LeadDuplicateQuery) =>
  queryOptions({
    queryKey: leadsKeys.duplicates(query),
    queryFn: () => call(api.POST('/api/leads/duplicates', { body: query })),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

export const conversionPlanQuery = (id: string, clientId?: string) =>
  queryOptions({
    queryKey: leadsKeys.conversionPlan(id, clientId),
    queryFn: () =>
      call(
        api.GET('/api/leads/{id}/conversion-plan', {
          params: { path: { id }, query: clientId ? { clientId } : {} },
        }),
      ),
    // Switching clients keeps the dialog filled while the new plan loads.
    placeholderData: keepPreviousData,
  });

/**
 * A mutation on lead data. Every one refreshes the whole `leads` cache, also on failure: a 403
 * after the owner changed (edge case 9) reloads the page without its actions. `also` names other
 * modules the change reaches (quotes rejected on loss, a client created on conversion).
 */
function useLeadsMutation<Input, Output>(
  mutationFn: (input: Input) => Promise<Output>,
  also: readonly (readonly string[])[] = [],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      Promise.all(
        [leadsKeys.all, ...also].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ),
  });
}

const path = (id: string) => ({ params: { path: { id } } });

export const useCreateLead = () =>
  useLeadsMutation((input: CreateLead) => call(api.POST('/api/leads', { body: input })));

export const useUpdateLead = (id: string) =>
  useLeadsMutation((input: UpdateLead) =>
    call(api.PATCH('/api/leads/{id}', { ...path(id), body: input })),
  );

export const useMoveLead = () =>
  useLeadsMutation(({ id, ...input }: LeadStageChange & { id: string }) =>
    call(api.POST('/api/leads/{id}/stage', { ...path(id), body: input })),
  );

export const useChangeLeadOwner = (id: string) =>
  useLeadsMutation((ownerId: string) =>
    call(api.POST('/api/leads/{id}/owner', { ...path(id), body: { ownerId } })),
  );

export const useLoseLead = (id: string) =>
  useLeadsMutation(
    (input: LoseLead) => call(api.POST('/api/leads/{id}/lose', { ...path(id), body: input })),
    [['quotes']],
  );

export const useReopenLead = (id: string) =>
  useLeadsMutation((input: ReopenLead) =>
    call(api.POST('/api/leads/{id}/reopen', { ...path(id), body: input })),
  );

export const useConvertLead = (id: string) =>
  useLeadsMutation(
    (input: ConvertLead) => call(api.POST('/api/leads/{id}/convert', { ...path(id), body: input })),
    [['quotes'], ['clients']],
  );

export const useArchiveLead = () =>
  useLeadsMutation((id: string) => call(api.POST('/api/leads/{id}/archive', path(id))));

export const useRestoreLead = () =>
  useLeadsMutation((id: string) => call(api.POST('/api/leads/{id}/restore', path(id))));

export const useAddLeadNote = (id: string) =>
  useLeadsMutation((input: CreateLeadNote) =>
    call(api.POST('/api/leads/{id}/notes', { ...path(id), body: input })),
  );

export const useUpdateLeadNote = (id: string) =>
  useLeadsMutation(({ noteId, ...input }: UpdateLeadNote & { noteId: string }) =>
    call(
      api.PATCH('/api/leads/{id}/notes/{noteId}', {
        params: { path: { id, noteId } },
        body: input,
      }),
    ),
  );

export const useArchiveLeadNote = (id: string) =>
  useLeadsMutation((noteId: string) =>
    call(api.POST('/api/leads/{id}/notes/{noteId}/archive', { params: { path: { id, noteId } } })),
  );
