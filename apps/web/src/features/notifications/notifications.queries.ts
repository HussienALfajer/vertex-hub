import {
  keepPreviousData,
  type QueryClient,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  NotificationPage,
  NotificationSettings,
  NotificationStreamEvent,
  UnreadCount,
  UpdateNotificationSettings,
} from '@vertex-hub/contracts';
import { toast } from '@vertex-hub/ui';
import { useTranslation } from 'react-i18next';
import { api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';
import { errorMessage } from '../../lib/errors';

/** The list endpoint's query string as the API reads it: flags are `'true'` or `'false'`. */
export type NotificationListFilters = NonNullable<
  paths['/api/me/notifications']['get']['parameters']['query']
>;

/** The bell's dropdown: the newest notifications (F14 screen 1). */
export const BELL_FILTERS: NotificationListFilters = { pageSize: 10 };

export const notificationsKeys = {
  lists: ['notifications', 'list'] as const,
  list: (filters: NotificationListFilters) => ['notifications', 'list', filters] as const,
  unreadCount: ['notifications', 'unread-count'] as const,
  settings: ['notifications', 'settings'] as const,
};

export const notificationListQuery = (filters: NotificationListFilters) =>
  queryOptions({
    queryKey: notificationsKeys.list(filters),
    queryFn: () => call(api.GET('/api/me/notifications', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const unreadCountQuery = queryOptions({
  queryKey: notificationsKeys.unreadCount,
  queryFn: () => call(api.GET('/api/me/notifications/unread-count')),
});

export const notificationSettingsQuery = queryOptions({
  queryKey: notificationsKeys.settings,
  queryFn: () => call(api.GET('/api/me/notification-settings')),
});

/** Refetches the count and every list (after a reconnect, on window focus, after a change). */
export function refreshNotifications(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: notificationsKeys.unreadCount }),
    queryClient.invalidateQueries({ queryKey: notificationsKeys.lists }),
  ]);
}

/**
 * A pushed notification: the count and the bell's list change in place (a merged comment moves
 * to the top), other lists refetch.
 */
export async function applyStreamEvent(queryClient: QueryClient, event: NotificationStreamEvent) {
  const { notification, unreadCount } = event;
  const bellKey = notificationsKeys.list(BELL_FILTERS);
  // A request that started before the event would overwrite it with older data; a cancelled
  // bell request runs again below.
  const bellFetching = queryClient.isFetching({ queryKey: bellKey, exact: true }) > 0;
  await Promise.all([
    queryClient.cancelQueries({ queryKey: notificationsKeys.unreadCount }),
    queryClient.cancelQueries({ queryKey: bellKey, exact: true }),
  ]);
  queryClient.setQueryData<UnreadCount>(notificationsKeys.unreadCount, { count: unreadCount });
  queryClient.setQueryData<NotificationPage>(bellKey, (page) => {
    if (!page) return page;
    const known = page.items.some((item) => item.id === notification.id);
    const items = [notification, ...page.items.filter((item) => item.id !== notification.id)];
    return {
      ...page,
      items: items.slice(0, page.pageSize),
      total: known ? page.total : page.total + 1,
    };
  });
  const refetchBell = bellFetching || queryClient.getQueryData(bellKey) === undefined;
  return queryClient.invalidateQueries({
    queryKey: notificationsKeys.lists,
    predicate: (query) => refetchBell || JSON.stringify(query.queryKey) !== JSON.stringify(bellKey),
  });
}

/** A read-state change that failed says so: the dot and count would otherwise just stay. */
function useFailureToast() {
  const { t } = useTranslation();
  return (error: Error) => toast.add({ title: errorMessage(t, error), type: 'error' });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  const onError = useFailureToast();
  return useMutation({
    onError,
    mutationFn: (id: string) =>
      call(api.POST('/api/me/notifications/{id}/read', { params: { path: { id } } })),
    onSuccess: () => refreshNotifications(queryClient),
  });
}

export function useMarkUnread() {
  const queryClient = useQueryClient();
  const onError = useFailureToast();
  return useMutation({
    onError,
    mutationFn: (id: string) =>
      call(api.POST('/api/me/notifications/{id}/unread', { params: { path: { id } } })),
    onSuccess: () => refreshNotifications(queryClient),
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  const onError = useFailureToast();
  return useMutation({
    onError,
    mutationFn: () => call(api.POST('/api/me/notifications/read-all')),
    onSuccess: () => refreshNotifications(queryClient),
  });
}

export function useUpdateNotificationSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateNotificationSettings) =>
      call(api.PUT('/api/me/notification-settings', { body: input })),
    onSuccess: (settings: NotificationSettings) =>
      queryClient.setQueryData(notificationsKeys.settings, settings),
  });
}
