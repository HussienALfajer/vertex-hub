import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateTemplate, TemplateDetail, UpdateTemplate } from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';

export type TemplateListFilters = NonNullable<
  paths['/api/templates']['get']['parameters']['query']
>;

export const templatesKeys = {
  all: ['templates'] as const,
  list: (filters: TemplateListFilters) => ['templates', 'list', filters] as const,
  detail: (id: string) => ['templates', 'detail', id] as const,
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
