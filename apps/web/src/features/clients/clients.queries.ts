import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  CLIENT_STATUSES,
  type CreateClient,
  type CreateContact,
  type CreateNote,
  type CreatePlatformAccount,
  type NoteListQuery,
  type UpdateBrandKit,
  type UpdateClient,
  type UpdateContact,
  type UpdateNote,
  type UpdatePlatformAccount,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';
import { userListQuery } from '../users/users.queries';

/** The list endpoint's query string as the API reads it: flags are `'true'` or `'false'`. */
export type ClientListFilters = NonNullable<paths['/api/clients']['get']['parameters']['query']>;

export type NoteFilters = Pick<Partial<NoteListQuery>, 'channel' | 'contactId'>;

export const clientsKeys = {
  all: ['clients'] as const,
  list: (filters: ClientListFilters) => ['clients', 'list', filters] as const,
  detail: (id: string) => ['clients', 'detail', id] as const,
  sectors: ['clients', 'sectors'] as const,
  notes: (id: string, filters: NoteFilters) => ['clients', 'notes', id, filters] as const,
};

export const clientListQuery = (filters: ClientListFilters) =>
  queryOptions({
    queryKey: clientsKeys.list(filters),
    queryFn: () => call(api.GET('/api/clients', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

/**
 * The account managers of every client the user can list, by name. The users list filters by
 * role for user managers only, so filters for other readers take their choices from here.
 */
export function useClientAccountManagers(): { id: string; name: string }[] {
  const everyClient = useQuery(clientListQuery({ status: [...CLIENT_STATUSES], pageSize: 100 }));
  const managers = new Map(
    (everyClient.data?.items ?? []).map(({ accountManager }) => [
      accountManager.id,
      accountManager.name,
    ]),
  );
  return [...managers]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

export const clientQuery = (id: string) =>
  queryOptions({
    queryKey: clientsKeys.detail(id),
    queryFn: () => call(api.GET('/api/clients/{id}', { params: { path: { id } } })),
  });

export const sectorsQuery = queryOptions({
  queryKey: clientsKeys.sectors,
  queryFn: () => call(api.GET('/api/clients/sectors')),
  staleTime: 5 * 60_000,
});

const NOTES_PAGE_SIZE = 20;

/** The communication log, newest first, one page at a time ("Show older"). */
export const notesQuery = (id: string, filters: NoteFilters) =>
  infiniteQueryOptions({
    queryKey: clientsKeys.notes(id, filters),
    queryFn: ({ pageParam }) =>
      call(
        api.GET('/api/clients/{id}/notes', {
          params: {
            path: { id },
            query: { ...filters, page: pageParam, pageSize: NOTES_PAGE_SIZE },
          },
        }),
      ),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
    placeholderData: keepPreviousData,
  });

/** Users who may be a client's account manager: not archived, with the role (F02 rule 2). */
export const accountManagersQuery = userListQuery({ role: 'account_manager', pageSize: 100 });

export const invitedAccountManagersQuery = userListQuery({
  role: 'account_manager',
  status: 'invited',
  pageSize: 100,
});

/**
 * A mutation on client data. Every one refreshes the whole `clients` cache, also on failure: a
 * 403 after the account manager changed (edge case 2) reloads the profile without edit actions.
 * Archiving a client hides its projects, retainers and tasks (F02, F05 G2), so those refresh too.
 */
function useClientsMutation<Input, Output>(mutationFn: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      Promise.all(
        [clientsKeys.all, ['projects'], ['retainers'], ['tasks']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

const path = (id: string) => ({ params: { path: { id } } });

export const useCreateClient = () =>
  useClientsMutation((input: CreateClient) => call(api.POST('/api/clients', { body: input })));

export const useUpdateClient = (id: string) =>
  useClientsMutation((input: UpdateClient) =>
    call(api.PATCH('/api/clients/{id}', { ...path(id), body: input })),
  );

export const useArchiveClient = (id: string) =>
  useClientsMutation(() => call(api.POST('/api/clients/{id}/archive', path(id))));

export const useRestoreClient = (id: string) =>
  useClientsMutation(() => call(api.POST('/api/clients/{id}/restore', path(id))));

export const useReplaceBrandKit = (id: string) =>
  useClientsMutation((kit: UpdateBrandKit) =>
    call(api.PUT('/api/clients/{id}/brand-kit', { ...path(id), body: kit })),
  );

export const useCreateContact = (id: string) =>
  useClientsMutation((input: CreateContact) =>
    call(api.POST('/api/clients/{id}/contacts', { ...path(id), body: input })),
  );

export const useUpdateContact = (id: string) =>
  useClientsMutation(({ contactId, ...input }: UpdateContact & { contactId: string }) =>
    call(
      api.PATCH('/api/clients/{id}/contacts/{contactId}', {
        params: { path: { id, contactId } },
        body: input,
      }),
    ),
  );

export const useArchiveContact = (id: string) =>
  useClientsMutation((contactId: string) =>
    call(
      api.POST('/api/clients/{id}/contacts/{contactId}/archive', {
        params: { path: { id, contactId } },
      }),
    ),
  );

export const useCreatePlatformAccount = (id: string) =>
  useClientsMutation((input: CreatePlatformAccount) =>
    call(api.POST('/api/clients/{id}/platform-accounts', { ...path(id), body: input })),
  );

export const useUpdatePlatformAccount = (id: string) =>
  useClientsMutation(({ accountId, ...input }: UpdatePlatformAccount & { accountId: string }) =>
    call(
      api.PATCH('/api/clients/{id}/platform-accounts/{accountId}', {
        params: { path: { id, accountId } },
        body: input,
      }),
    ),
  );

export const useArchivePlatformAccount = (id: string) =>
  useClientsMutation((accountId: string) =>
    call(
      api.POST('/api/clients/{id}/platform-accounts/{accountId}/archive', {
        params: { path: { id, accountId } },
      }),
    ),
  );

export const useCreateNote = (id: string) =>
  useClientsMutation((input: CreateNote) =>
    call(api.POST('/api/clients/{id}/notes', { ...path(id), body: input })),
  );

export const useUpdateNote = (id: string) =>
  useClientsMutation(({ noteId, ...input }: UpdateNote & { noteId: string }) =>
    call(
      api.PATCH('/api/clients/{id}/notes/{noteId}', {
        params: { path: { id, noteId } },
        body: input,
      }),
    ),
  );

export const useArchiveNote = (id: string) =>
  useClientsMutation((noteId: string) =>
    call(
      api.POST('/api/clients/{id}/notes/{noteId}/archive', { params: { path: { id, noteId } } }),
    ),
  );
