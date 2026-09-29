import { infiniteQueryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreateExtraWork,
  ExtraWorkBillingChange,
  UpdateExtraWork,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import { retainersKeys } from '../retainers/retainers.queries';
import { projectsKeys } from './projects.queries';

/** What extra work is logged on: a project or a retainer (the same five endpoints under each). */
export interface ExtraWorkParent {
  kind: 'project' | 'retainer';
  id: string;
}

const keyOf = (parent: ExtraWorkParent) =>
  parent.kind === 'project'
    ? projectsKeys.extraWork(parent.id)
    : retainersKeys.extraWork(parent.id);

const PAGE_SIZE = 20;

/** The parent's extra work, newest request first, one page at a time ("Show older"). */
export const extraWorkQuery = (parent: ExtraWorkParent) =>
  infiniteQueryOptions({
    queryKey: keyOf(parent),
    queryFn: ({ pageParam }) => {
      const params = {
        params: { path: { id: parent.id }, query: { page: pageParam, pageSize: PAGE_SIZE } },
      };
      return parent.kind === 'project'
        ? call(api.GET('/api/projects/{id}/extra-work', params))
        : call(api.GET('/api/retainers/{id}/extra-work', params));
    },
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });

/**
 * A mutation on the parent's extra work. It refreshes the parent's whole cache (`projects` or
 * `retainers`), also on failure, like the parent's own mutations.
 */
function useExtraWorkMutation<Input, Output>(
  parent: ExtraWorkParent,
  mutationFn: (input: Input) => Promise<Output>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: parent.kind === 'project' ? projectsKeys.all : retainersKeys.all,
      }),
  });
}

const itemPath = (id: string, itemId: string) => ({ params: { path: { id, itemId } } });

export const useCreateExtraWork = (parent: ExtraWorkParent) =>
  useExtraWorkMutation(parent, (body: CreateExtraWork) => {
    const params = { params: { path: { id: parent.id } }, body };
    return parent.kind === 'project'
      ? call(api.POST('/api/projects/{id}/extra-work', params))
      : call(api.POST('/api/retainers/{id}/extra-work', params));
  });

export const useUpdateExtraWork = (parent: ExtraWorkParent) =>
  useExtraWorkMutation(parent, ({ itemId, ...body }: UpdateExtraWork & { itemId: string }) => {
    const params = { ...itemPath(parent.id, itemId), body };
    return parent.kind === 'project'
      ? call(api.PATCH('/api/projects/{id}/extra-work/{itemId}', params))
      : call(api.PATCH('/api/retainers/{id}/extra-work/{itemId}', params));
  });

export const useChangeExtraWorkBilling = (parent: ExtraWorkParent) =>
  useExtraWorkMutation(
    parent,
    ({ itemId, ...body }: ExtraWorkBillingChange & { itemId: string }) => {
      const params = { ...itemPath(parent.id, itemId), body };
      return parent.kind === 'project'
        ? call(api.POST('/api/projects/{id}/extra-work/{itemId}/billing', params))
        : call(api.POST('/api/retainers/{id}/extra-work/{itemId}/billing', params));
    },
  );

export const useArchiveExtraWork = (parent: ExtraWorkParent) =>
  useExtraWorkMutation(parent, (itemId: string) => {
    const params = itemPath(parent.id, itemId);
    return parent.kind === 'project'
      ? call(api.POST('/api/projects/{id}/extra-work/{itemId}/archive', params))
      : call(api.POST('/api/retainers/{id}/extra-work/{itemId}/archive', params));
  });
