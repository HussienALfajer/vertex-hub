import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreateTemplate,
  TemplateDetail,
  TemplateRunInput,
  UpdateTemplate,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';

export type TemplateListFilters = NonNullable<
  paths['/api/templates']['get']['parameters']['query']
>;

export type TemplateRunFilters = NonNullable<
  paths['/api/template-runs']['get']['parameters']['query']
>;

export const templatesKeys = {
  all: ['templates'] as const,
  list: (filters: TemplateListFilters) => ['templates', 'list', filters] as const,
  detail: (id: string) => ['templates', 'detail', id] as const,
  runs: (filters: TemplateRunFilters) => ['templates', 'runs', filters] as const,
  preview: (id: string, input: TemplateRunInput) => ['templates', 'preview', id, input] as const,
  retainer: (retainerId: string) => ['templates', 'retainer', retainerId] as const,
};

export const templateListQuery = (filters: TemplateListFilters) =>
  queryOptions({
    queryKey: templatesKeys.list(filters),
    queryFn: () => call(api.GET('/api/templates', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const templateQuery = (id: string) =>
  queryOptions({
    queryKey: templatesKeys.detail(id),
    queryFn: () => call(api.GET('/api/templates/{id}', { params: { path: { id } } })),
  });

/** Runs of a project, a retainer or a task, newest first. */
export const templateRunsQuery = (filters: TemplateRunFilters) =>
  queryOptions({
    queryKey: templatesKeys.runs(filters),
    queryFn: () => call(api.GET('/api/template-runs', { params: { query: filters } })),
  });

/** What applying the template would create; re-planned on every change of the input. */
export const templatePreviewQuery = (id: string, input: TemplateRunInput) =>
  queryOptions({
    queryKey: templatesKeys.preview(id, input),
    queryFn: () =>
      call(api.POST('/api/templates/{id}/preview', { params: { path: { id } }, body: input })),
    placeholderData: keepPreviousData,
    retry: false,
  });

/** A retainer's monthly template, its current cycle's run and the lines' task counts. */
export const retainerTemplateQuery = (retainerId: string) =>
  queryOptions({
    queryKey: templatesKeys.retainer(retainerId),
    queryFn: () =>
      call(api.GET('/api/retainers/{id}/template', { params: { path: { id: retainerId } } })),
  });

/**
 * A run creates tasks, and project runs milestones: the task lists, the project or retainer pages
 * (milestones, cycle counters) and the runs all change.
 */
function useInvalidateRuns() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['templates', 'tasks', 'projects', 'retainers'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

export function useRunTemplate(id: string) {
  const invalidate = useInvalidateRuns();
  return useMutation({
    mutationFn: (input: TemplateRunInput) =>
      call(api.POST('/api/templates/{id}/runs', { params: { path: { id } }, body: input })),
    onSuccess: invalidate,
  });
}

export function useGenerateMissingTasks(retainerId: string, cycleId: string) {
  const invalidate = useInvalidateRuns();
  return useMutation({
    mutationFn: (lineId: string) =>
      call(
        api.POST('/api/retainers/{id}/cycles/{cycleId}/lines/{lineId}/missing-tasks', {
          params: { path: { id: retainerId, cycleId, lineId } },
        }),
      ),
    onSuccess: invalidate,
  });
}

/** Linking changes the retainer's panel and the template's linked retainers. */
export function useSetRetainerTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ retainerId, templateId }: { retainerId: string; templateId: string | null }) =>
      call(
        api.PUT('/api/retainers/{id}/template', {
          params: { path: { id: retainerId } },
          body: { templateId },
        }),
      ),
    onSuccess: (state, { retainerId }) => {
      queryClient.setQueryData(templatesKeys.retainer(retainerId), state);
      return queryClient.invalidateQueries({ queryKey: templatesKeys.all });
    },
  });
}

/**
 * A saved template refreshes the lists and its page; retainers show their linked template's name
 * and whether it is archived.
 */
function useInvalidateTemplates() {
  const queryClient = useQueryClient();
  return (template: TemplateDetail) => {
    queryClient.setQueryData(templatesKeys.detail(template.id), template);
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: templatesKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['retainers'] }),
    ]);
  };
}

export function useCreateTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (input: CreateTemplate) => call(api.POST('/api/templates', { body: input })),
    onSuccess: invalidate,
  });
}

export function useUpdateTemplate(id: string) {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (input: UpdateTemplate) =>
      call(api.PUT('/api/templates/{id}', { params: { path: { id } }, body: input })),
    onSuccess: invalidate,
  });
}

export function useArchiveTemplate(id: string) {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: () => call(api.POST('/api/templates/{id}/archive', { params: { path: { id } } })),
    onSuccess: invalidate,
  });
}

export function useRestoreTemplate(id: string) {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: () => call(api.POST('/api/templates/{id}/restore', { params: { path: { id } } })),
    onSuccess: invalidate,
  });
}
