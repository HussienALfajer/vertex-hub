import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreateUser,
  UpdateOwnProfile,
  UpdateUser,
  UserListQuery,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';

export type UserListFilters = Partial<UserListQuery>;

export const usersKeys = {
  all: ['users'] as const,
  list: (filters: UserListFilters) => ['users', 'list', filters] as const,
  detail: (id: string) => ['users', 'detail', id] as const,
  skills: ['users', 'skills'] as const,
};

export const userListQuery = (filters: UserListFilters) =>
  queryOptions({
    queryKey: usersKeys.list(filters),
    queryFn: () => call(api.GET('/api/users', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const userQuery = (id: string) =>
  queryOptions({
    queryKey: usersKeys.detail(id),
    queryFn: () => call(api.GET('/api/users/{id}', { params: { path: { id } } })),
  });

export const skillsQuery = queryOptions({
  queryKey: usersKeys.skills,
  queryFn: () => call(api.GET('/api/users/skills')),
  staleTime: 5 * 60_000,
});

/** Changes to users also change departments (members, managers) and possibly the viewer's access. */
function useInvalidateTeam() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: usersKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['departments'] }),
      queryClient.invalidateQueries({ queryKey: ['me'] }),
    ]);
}

export function useCreateUser() {
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: (input: CreateUser) => call(api.POST('/api/users', { body: input })),
    onSuccess: invalidate,
  });
}

export function useUpdateUser(id: string) {
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: (input: UpdateUser) =>
      call(api.PATCH('/api/users/{id}', { params: { path: { id } }, body: input })),
    onSuccess: invalidate,
  });
}

export function useIssueLink(id: string) {
  return useMutation({
    mutationFn: () => call(api.POST('/api/users/{id}/link', { params: { path: { id } } })),
  });
}

export function useArchiveUser(id: string) {
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: () => call(api.POST('/api/users/{id}/archive', { params: { path: { id } } })),
    onSuccess: invalidate,
  });
}

export function useRestoreUser(id: string) {
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: () => call(api.POST('/api/users/{id}/restore', { params: { path: { id } } })),
    onSuccess: invalidate,
  });
}

export function useResetTwoFactor(id: string) {
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: () =>
      call(api.POST('/api/users/{id}/two-factor/reset', { params: { path: { id } } })),
    onSuccess: invalidate,
  });
}

export function useUpdateOwnProfile() {
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: (input: UpdateOwnProfile) => call(api.PATCH('/api/me/profile', { body: input })),
    onSuccess: invalidate,
  });
}
