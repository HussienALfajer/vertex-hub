import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ArchiveSalaryChange,
  CreateSalaryChange,
  EmployeeListQuery,
  EndService,
  Payout,
  UpdateEmployeeFile,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';

export type EmployeeListFilters = Partial<EmployeeListQuery>;

export const hrKeys = {
  all: ['hr'] as const,
  employees: ['hr', 'employees'] as const,
  employeeList: (filters: EmployeeListFilters) => ['hr', 'employees', 'list', filters] as const,
  employee: (userId: string) => ['hr', 'employees', 'detail', userId] as const,
  salaries: (userId: string) => ['hr', 'employees', 'salaries', userId] as const,
};

export const employeeListQuery = (filters: EmployeeListFilters) =>
  queryOptions({
    queryKey: hrKeys.employeeList(filters),
    queryFn: () => call(api.GET('/api/hr/employees', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const employeeQuery = (userId: string) =>
  queryOptions({
    queryKey: hrKeys.employee(userId),
    queryFn: () => call(api.GET('/api/hr/employees/{userId}', { params: { path: { userId } } })),
  });

export const salaryChangesQuery = (userId: string) =>
  queryOptions({
    queryKey: hrKeys.salaries(userId),
    queryFn: () =>
      call(api.GET('/api/hr/employees/{userId}/salaries', { params: { path: { userId } } })),
  });

/**
 * A file change shows in People and on the file; ending a service also changes the member's
 * account (F01), so the team lists refresh too.
 */
function useInvalidateEmployees() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: hrKeys.employees }),
      queryClient.invalidateQueries({ queryKey: ['users'] }),
    ]);
}

export function useUpdateEmployeeFile(userId: string) {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: (input: UpdateEmployeeFile) =>
      call(api.PATCH('/api/hr/employees/{userId}', { params: { path: { userId } }, body: input })),
    onSuccess: invalidate,
  });
}

export function useSetPayout(userId: string) {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: (input: Payout) =>
      call(
        api.PUT('/api/hr/employees/{userId}/payout', {
          params: { path: { userId } },
          body: input,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useEndService(userId: string) {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: (input: EndService) =>
      call(
        api.POST('/api/hr/employees/{userId}/end', { params: { path: { userId } }, body: input }),
      ),
    onSuccess: invalidate,
  });
}

export function useClearEnd(userId: string) {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: () =>
      call(api.DELETE('/api/hr/employees/{userId}/end', { params: { path: { userId } } })),
    onSuccess: invalidate,
  });
}

/** A salary change moves the current salary on the file and in People. */
export function useAddSalaryChange(userId: string) {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: (input: CreateSalaryChange) =>
      call(
        api.POST('/api/hr/employees/{userId}/salaries', {
          params: { path: { userId } },
          body: input,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useArchiveSalaryChange() {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: ({ id, ...input }: ArchiveSalaryChange & { id: string }) =>
      call(api.POST('/api/hr/salaries/{id}/archive', { params: { path: { id } }, body: input })),
    onSuccess: invalidate,
  });
}
