import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ArchiveDepartment,
  CreateDepartment,
  DepartmentDetailResponse,
  UpdateDepartment,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';

export const departmentsKeys = {
  all: ['departments'] as const,
  list: ['departments', 'list'] as const,
  detail: (id: string) => ['departments', 'detail', id] as const,
  overview: (id: string) => ['departments', 'overview', id] as const,
  archivePreview: (id: string) => ['departments', 'archive-preview', id] as const,
};

export const departmentListQuery = queryOptions({
  queryKey: departmentsKeys.list,
  queryFn: () => call(api.GET('/api/departments')),
  staleTime: 60_000,
});

export const departmentQuery = (id: string) =>
  queryOptions({
    queryKey: departmentsKeys.detail(id),
    queryFn: () => call(api.GET('/api/departments/{id}', { params: { path: { id } } })),
  });

export const departmentOverviewQuery = (id: string) =>
  queryOptions({
    queryKey: departmentsKeys.overview(id),
    queryFn: () => call(api.GET('/api/departments/{id}/overview', { params: { path: { id } } })),
  });

export const departmentArchivePreviewQuery = (id: string) =>
  queryOptions({
    queryKey: departmentsKeys.archivePreview(id),
    queryFn: () =>
      call(api.GET('/api/departments/{id}/archive-preview', { params: { path: { id } } })),
    // Rule 12: the preview is advisory; every opening of the wizard reads it again.
    staleTime: 0,
  });

/**
 * A department change reaches its lists and pickers everywhere, the team directory (members and
 * managers) and the signed-in user's own access (ADR 0014).
 */
function useDepartmentChanged() {
  const queryClient = useQueryClient();
  return (department?: DepartmentDetailResponse) => {
    if (department) queryClient.setQueryData(departmentsKeys.detail(department.id), department);
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: departmentsKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['users'] }),
      queryClient.invalidateQueries({ queryKey: ['me'] }),
    ]);
  };
}

export function useUpdateDepartment(id: string) {
  const queryClient = useQueryClient();
  const changed = useDepartmentChanged();
  return useMutation({
    mutationFn: (input: UpdateDepartment) =>
      call(api.PATCH('/api/departments/{id}', { params: { path: { id } }, body: input })),
    onSuccess: changed,
    // A refusal can come from a stale page (the chosen manager left the department meanwhile).
    onError: () => queryClient.invalidateQueries({ queryKey: departmentsKeys.detail(id) }),
  });
}

export function useCreateDepartment() {
  const changed = useDepartmentChanged();
  return useMutation({
    mutationFn: (input: CreateDepartment) => call(api.POST('/api/departments', { body: input })),
    onSuccess: changed,
  });
}

export function useReorderDepartments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => call(api.PUT('/api/departments/order', { body: { ids } })),
    onSuccess: (list) => {
      queryClient.setQueryData(departmentsKeys.list, list);
      return queryClient.invalidateQueries({ queryKey: departmentsKeys.all });
    },
    // Edge case 12: a stale list is refused; the screen reloads it.
    onError: () => queryClient.invalidateQueries({ queryKey: departmentsKeys.list }),
  });
}

/** Archiving moves people and work across the Hub (rule 10): every list may change. */
export function useArchiveDepartment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ArchiveDepartment) =>
      call(api.POST('/api/departments/{id}/archive', { params: { path: { id } }, body: input })),
    onSuccess: (department) => {
      queryClient.setQueryData(departmentsKeys.detail(id), department);
      // The preview of an archived department is refused from now on: drop it, not refetch it.
      queryClient.removeQueries({ queryKey: departmentsKeys.archivePreview(id) });
      return queryClient.invalidateQueries();
    },
    onError: () => queryClient.invalidateQueries({ queryKey: departmentsKeys.all }),
  });
}

export function useRestoreDepartment(id: string) {
  const changed = useDepartmentChanged();
  return useMutation({
    mutationFn: () => call(api.POST('/api/departments/{id}/restore', { params: { path: { id } } })),
    onSuccess: changed,
  });
}

export function useAddDepartmentMembers(id: string) {
  const changed = useDepartmentChanged();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      call(
        api.POST('/api/departments/{id}/members', {
          params: { path: { id } },
          body: { userIds },
        }),
      ),
    onSuccess: changed,
  });
}

/** Make primary, move and remove: each answers with this department's page (rules 18–20). */
export function useDepartmentMemberAction(id: string) {
  const queryClient = useQueryClient();
  const changed = useDepartmentChanged();
  return useMutation({
    mutationFn: (
      action:
        | { kind: 'primary'; userId: string }
        | { kind: 'move'; userId: string; departmentId: string }
        | { kind: 'remove'; userId: string },
    ) => {
      const path = { id, userId: action.userId };
      switch (action.kind) {
        case 'primary':
          return call(
            api.POST('/api/departments/{id}/members/{userId}/primary', { params: { path } }),
          );
        case 'move':
          return call(
            api.POST('/api/departments/{id}/members/{userId}/move', {
              params: { path },
              body: { departmentId: action.departmentId },
            }),
          );
        case 'remove':
          return call(api.DELETE('/api/departments/{id}/members/{userId}', { params: { path } }));
      }
    },
    onSuccess: changed,
    onError: () => queryClient.invalidateQueries({ queryKey: departmentsKeys.detail(id) }),
  });
}
