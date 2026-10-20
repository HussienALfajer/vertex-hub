import {
  keepPreviousData,
  type QueryClient,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type { Announcement, AnnouncementReceiptsQuery } from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';
import { refreshNotifications } from '../notifications/notifications.queries';

/** The list endpoint's query string as the API reads it. */
export type AnnouncementListFilters = NonNullable<
  paths['/api/announcements']['get']['parameters']['query']
>;

/** The request bodies as the API documents them (the contract's input types). */
type JsonBody<T extends { requestBody?: unknown }> =
  NonNullable<T['requestBody']> extends { content: { 'application/json': infer Body } }
    ? Body
    : never;

export type CreateAnnouncementBody = JsonBody<paths['/api/announcements']['post']>;

export type UpdateAnnouncementBody = JsonBody<paths['/api/announcements/{id}']['patch']>;

export type CreateTemplateBody = JsonBody<paths['/api/announcement-templates']['post']>;

export type UpdateTemplateBody = JsonBody<paths['/api/announcement-templates/{id}']['patch']>;

export const announcementsKeys = {
  all: ['announcements'] as const,
  lists: ['announcements', 'list'] as const,
  list: (filters: AnnouncementListFilters) => ['announcements', 'list', filters] as const,
  detail: (id: string) => ['announcements', 'detail', id] as const,
  receipts: (id: string, filter: AnnouncementReceiptsQuery['filter']) =>
    ['announcements', 'receipts', id, filter] as const,
  home: ['announcements', 'home'] as const,
  templates: ['announcements', 'templates'] as const,
};

export const announcementListQuery = (filters: AnnouncementListFilters) =>
  queryOptions({
    queryKey: announcementsKeys.list(filters),
    queryFn: () => call(api.GET('/api/announcements', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

/** Reading an announcement opens it (rule D4): its notification may resolve. */
export const announcementQuery = (id: string) =>
  queryOptions({
    queryKey: announcementsKeys.detail(id),
    queryFn: () => call(api.GET('/api/announcements/{id}', { params: { path: { id } } })),
  });

export const announcementReceiptsQuery = (
  id: string,
  filter: AnnouncementReceiptsQuery['filter'],
) =>
  queryOptions({
    queryKey: announcementsKeys.receipts(id, filter),
    queryFn: () =>
      call(
        api.GET('/api/announcements/{id}/receipts', {
          params: { path: { id }, query: { filter } },
        }),
      ),
    placeholderData: keepPreviousData,
  });

/**
 * Rules D6, D7: the pinned announcements of the home page and the unacknowledged critical ones,
 * checked again whenever the app regains focus.
 */
export const announcementHomeQuery = queryOptions({
  queryKey: announcementsKeys.home,
  queryFn: () => call(api.GET('/api/announcements/home')),
  refetchOnWindowFocus: 'always',
});

export const announcementTemplatesQuery = queryOptions({
  queryKey: announcementsKeys.templates,
  queryFn: () => call(api.GET('/api/announcement-templates')),
});

/** An announcement changed: every list, its page, the home page and the bell may show it. */
function refreshAnnouncements(queryClient: QueryClient, announcement?: Announcement) {
  if (announcement) {
    queryClient.setQueryData(announcementsKeys.detail(announcement.id), announcement);
  }
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: announcementsKeys.all,
      predicate: (query) =>
        !announcement ||
        JSON.stringify(query.queryKey) !==
          JSON.stringify(announcementsKeys.detail(announcement.id)),
    }),
    refreshNotifications(queryClient),
  ]);
}

export function useCreateAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAnnouncementBody) =>
      call(api.POST('/api/announcements', { body: input })),
    onSuccess: (announcement) => refreshAnnouncements(queryClient, announcement),
  });
}

export function useUpdateAnnouncement(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAnnouncementBody) =>
      call(api.PATCH('/api/announcements/{id}', { params: { path: { id } }, body: input })),
    onSuccess: (announcement) => refreshAnnouncements(queryClient, announcement),
  });
}

/** Rule D5: a draft goes now, or at `scheduledAt`. */
export function useSendAnnouncement(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scheduledAt?: string) =>
      call(
        api.POST('/api/announcements/{id}/send', {
          params: { path: { id } },
          body: scheduledAt ? { scheduledAt } : {},
        }),
      ),
    onSuccess: (announcement) => refreshAnnouncements(queryClient, announcement),
  });
}

/** An announcement action answered with the announcement. */
function useAnnouncementAction(
  id: string,
  path: '/api/announcements/{id}/cancel-schedule' | '/api/announcements/{id}/withdraw',
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => call(api.POST(path, { params: { path: { id } } })),
    onSuccess: (announcement) => refreshAnnouncements(queryClient, announcement),
  });
}

export const useCancelSchedule = (id: string) =>
  useAnnouncementAction(id, '/api/announcements/{id}/cancel-schedule');

export const useWithdrawAnnouncement = (id: string) =>
  useAnnouncementAction(id, '/api/announcements/{id}/withdraw');

/** Rule D10: a draft is discarded by archiving. */
export function useArchiveAnnouncement(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      call(api.POST('/api/announcements/{id}/archive', { params: { path: { id } } })),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: announcementsKeys.detail(id) });
      return refreshAnnouncements(queryClient);
    },
  });
}

/** Rule D4: "I have read this" resolves its notification and reminders. */
export function useAcknowledgeAnnouncement(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      call(api.POST('/api/announcements/{id}/acknowledge', { params: { path: { id } } })),
    onSuccess: () => refreshAnnouncements(queryClient),
  });
}

/** Rule D8: remind those who have not acknowledged, at most once an hour. */
export function useRemindAnnouncement(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      call(api.POST('/api/announcements/{id}/remind', { params: { path: { id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: announcementsKeys.detail(id) }),
  });
}

/** Rule D11: the caller's whole vote, or the author closing the poll; the page shows the poll. */
function usePollChange<Variables>(
  id: string,
  request: (variables: Variables) => Promise<Announcement['poll']>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (poll) => {
      queryClient.setQueryData<Announcement>(announcementsKeys.detail(id), (current) =>
        current ? { ...current, poll } : current,
      );
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: announcementsKeys.lists }),
        refreshNotifications(queryClient),
      ]);
    },
  });
}

export const useVote = (id: string) =>
  usePollChange(id, (optionIds: string[]) =>
    call(
      api.PUT('/api/announcements/{id}/poll/vote', {
        params: { path: { id } },
        body: { optionIds },
      }),
    ),
  );

export const useClosePoll = (id: string) =>
  usePollChange(id, () =>
    call(api.POST('/api/announcements/{id}/poll/close', { params: { path: { id } } })),
  );

/* Templates (rule D12) */

export function useCreateAnnouncementTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTemplateBody) =>
      call(api.POST('/api/announcement-templates', { body: input })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: announcementsKeys.templates }),
  });
}

export function useUpdateAnnouncementTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTemplateBody }) =>
      call(
        api.PATCH('/api/announcement-templates/{id}', { params: { path: { id } }, body: input }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: announcementsKeys.templates }),
  });
}

export function useArchiveAnnouncementTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      call(api.POST('/api/announcement-templates/{id}/archive', { params: { path: { id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: announcementsKeys.templates }),
  });
}
