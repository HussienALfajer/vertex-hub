import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CompleteMilestone,
  CreateMilestone,
  CreateProject,
  ProjectStatusChange,
  UpdateMilestone,
  UpdateProject,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';

/** The list endpoint's query string as the API reads it: flags are `'true'` or `'false'`. */
export type ProjectListFilters = NonNullable<paths['/api/projects']['get']['parameters']['query']>;

export const projectsKeys = {
  all: ['projects'] as const,
  list: (filters: ProjectListFilters) => ['projects', 'list', filters] as const,
  detail: (id: string) => ['projects', 'detail', id] as const,
  extraWork: (id: string) => ['projects', 'extra-work', id] as const,
};

export const projectListQuery = (filters: ProjectListFilters) =>
  queryOptions({
    queryKey: projectsKeys.list(filters),
    queryFn: () => call(api.GET('/api/projects', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const projectQuery = (id: string) =>
  queryOptions({
    queryKey: projectsKeys.detail(id),
    queryFn: () => call(api.GET('/api/projects/{id}', { params: { path: { id } } })),
  });

/**
 * A mutation on project data. Every one refreshes the whole `projects` cache, also on failure: a
 * 403 after the project changed hands (edge case 10) reloads the page without edit actions. Task
 * views refresh too: cancelling a project cancels its open tasks, archiving hides them (F06).
 */
function useProjectsMutation<Input, Output>(mutationFn: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ]),
  });
}

const path = (id: string) => ({ params: { path: { id } } });

const milestonePath = (id: string, milestoneId: string) => ({
  params: { path: { id, milestoneId } },
});

export const useCreateProject = () =>
  useProjectsMutation((input: CreateProject) => call(api.POST('/api/projects', { body: input })));

export const useUpdateProject = (id: string) =>
  useProjectsMutation((input: UpdateProject) =>
    call(api.PATCH('/api/projects/{id}', { ...path(id), body: input })),
  );

export const useChangeProjectStatus = (id: string) =>
  useProjectsMutation((input: ProjectStatusChange) =>
    call(api.POST('/api/projects/{id}/status', { ...path(id), body: input })),
  );

export const useArchiveProject = (id: string) =>
  useProjectsMutation(() => call(api.POST('/api/projects/{id}/archive', path(id))));

export const useRestoreProject = (id: string) =>
  useProjectsMutation(() => call(api.POST('/api/projects/{id}/restore', path(id))));

export const useCreateMilestone = (id: string) =>
  useProjectsMutation((input: CreateMilestone) =>
    call(api.POST('/api/projects/{id}/milestones', { ...path(id), body: input })),
  );

export const useUpdateMilestone = (id: string) =>
  useProjectsMutation(({ milestoneId, ...input }: UpdateMilestone & { milestoneId: string }) =>
    call(
      api.PATCH('/api/projects/{id}/milestones/{milestoneId}', {
        ...milestonePath(id, milestoneId),
        body: input,
      }),
    ),
  );

export const useReorderMilestones = (id: string) =>
  useProjectsMutation((ids: string[]) =>
    call(api.PUT('/api/projects/{id}/milestones/order', { ...path(id), body: { ids } })),
  );

export const useCompleteMilestone = (id: string) =>
  useProjectsMutation(({ milestoneId, ...input }: CompleteMilestone & { milestoneId: string }) =>
    call(
      api.POST('/api/projects/{id}/milestones/{milestoneId}/complete', {
        ...milestonePath(id, milestoneId),
        body: input,
      }),
    ),
  );

export const useReopenMilestone = (id: string) =>
  useProjectsMutation((milestoneId: string) =>
    call(
      api.POST(
        '/api/projects/{id}/milestones/{milestoneId}/reopen',
        milestonePath(id, milestoneId),
      ),
    ),
  );

export const useArchiveMilestone = (id: string) =>
  useProjectsMutation((milestoneId: string) =>
    call(
      api.POST(
        '/api/projects/{id}/milestones/{milestoneId}/archive',
        milestonePath(id, milestoneId),
      ),
    ),
  );
