import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateDepartment } from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';

export const departmentsKeys = {
  all: ['departments'] as const,
  list: ['departments', 'list'] as const,
  detail: (id: string) => ['departments', 'detail', id] as const,
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

export function useUpdateDepartment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateDepartment) =>
      call(api.PATCH('/api/departments/{id}', { params: { path: { id } }, body: input })),
    onSuccess: (department) => {
      queryClient.setQueryData(departmentsKeys.detail(id), department);
      // A new manager changes their roles, and the team directory shows who manages what.
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: departmentsKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['users'] }),
        queryClient.invalidateQueries({ queryKey: ['me'] }),
      ]);
    },
  });
}
