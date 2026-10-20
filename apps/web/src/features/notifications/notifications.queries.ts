import {
  keepPreviousData,
  type QueryClient,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  Following,
  FollowSubject,
  NotificationInbox,
  NotificationPage,
  NotificationPolicyList,
  NotificationSettings,
  NotificationStreamEvent,
  NotificationType,
  SnoozeOption,
  UnreadCount,
  UpdateNotificationPolicy,
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

/** The push delivery log's query string (rule A15). */
export type PushDeliveryFilters = NonNullable<
  paths['/api/push-deliveries']['get']['parameters']['query']
>;

/** The inboxes the bell shows, 10 rows each (F16 screen 3). */
export const BELL_INBOXES = ['needs_you', 'fyi'] as const satisfies NotificationInbox[];

export type BellInbox = (typeof BELL_INBOXES)[number];

/** The bell's list of one inbox: its newest notifications, critical first. */
export const bellFilters = (inbox: BellInbox): NotificationListFilters => ({ inbox, pageSize: 10 });

export const notificationsKeys = {
  lists: ['notifications', 'list'] as const,
  list: (filters: NotificationListFilters) => ['notifications', 'list', filters] as const,
  unreadCount: ['notifications', 'unread-count'] as const,
  settings: ['notifications', 'settings'] as const,
  policies: ['notifications', 'policies'] as const,
  pushDeliveries: (filters: PushDeliveryFilters) =>
    ['notifications', 'push-deliveries', filters] as const,
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
 * A pushed notification: the count and the bell's list of its inbox change in place (a merged
 * comment moves to the top), other lists refetch.
 */
export async function applyStreamEvent(queryClient: QueryClient, event: NotificationStreamEvent) {
  const { notification, unreadCount } = event;
  const inbox = notification.inbox === 'needs_you' ? 'needs_you' : 'fyi';
  const bellKey = notificationsKeys.list(bellFilters(inbox));
  // A request that started before the event would overwrite it with older data; a cancelled
  // bell request runs again below.
  const bellFetching = queryClient.isFetching({ queryKey: bellKey, exact: true }) > 0;
  await Promise.all([
    queryClient.cancelQueries({ queryKey: notificationsKeys.unreadCount }),
    queryClient.cancelQueries({ queryKey: bellKey, exact: true }),
  ]);
  // The event carries the unread count only; "Needs you" keeps its last value until refetched.
  queryClient.setQueryData<UnreadCount>(notificationsKeys.unreadCount, (current) => ({
    count: unreadCount,
    needsYou: current?.needsYou ?? 0,
  }));
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
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: notificationsKeys.lists,
      predicate: (query) =>
        refetchBell || JSON.stringify(query.queryKey) !== JSON.stringify(bellKey),
    }),
    // A new "Needs you" row changes that count too, which the event does not carry.
    inbox === 'needs_you' &&
      queryClient.invalidateQueries({ queryKey: notificationsKeys.unreadCount }),
  ]);
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

/** Rule B8: "Remind me later"; the row leaves its list and the count until it wakes. */
export function useSnooze() {
  const queryClient = useQueryClient();
  const onError = useFailureToast();
  return useMutation({
    onError,
    mutationFn: ({ id, option }: { id: string; option: SnoozeOption }) =>
      call(
        api.POST('/api/me/notifications/{id}/snooze', {
          params: { path: { id } },
          body: { for: option },
        }),
      ),
    onSuccess: () => refreshNotifications(queryClient),
  });
}

/** Rule B8: wakes a snoozed row now. */
export function useUnsnooze() {
  const queryClient = useQueryClient();
  const onError = useFailureToast();
  return useMutation({
    onError,
    mutationFn: (id: string) =>
      call(api.POST('/api/me/notifications/{id}/unsnooze', { params: { path: { id } } })),
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

/* Channel policy and the push delivery log (F16 screen 6, `notifications.policy`). */

export const notificationPoliciesQuery = queryOptions({
  queryKey: notificationsKeys.policies,
  queryFn: () => call(api.GET('/api/notification-policies')),
});

/** Rule B2: one type's modes, or back to the defaults; the user settings read the policy. */
export function useUpdateNotificationPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ type, input }: { type: NotificationType; input: UpdateNotificationPolicy }) =>
      call(
        api.PUT('/api/notification-policies/{type}', {
          params: { path: { type } },
          body: input,
        }),
      ),
    onSuccess: (policy) => {
      queryClient.setQueryData<NotificationPolicyList>(notificationsKeys.policies, (list) =>
        list
          ? { items: list.items.map((item) => (item.type === policy.type ? policy : item)) }
          : list,
      );
      return queryClient.invalidateQueries({ queryKey: notificationsKeys.settings });
    },
  });
}

export const pushDeliveryListQuery = (filters: PushDeliveryFilters) =>
  queryOptions({
    queryKey: notificationsKeys.pushDeliveries(filters),
    queryFn: () => call(api.GET('/api/push-deliveries', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

/* Followers (F16 rule B12, screen 8). */

/** A record people follow: a task or a post. */
export type FollowTarget = { subject: FollowSubject; id: string };

export const followingQuery = ({ subject, id }: FollowTarget) =>
  queryOptions({
    queryKey: ['notifications', 'following', subject, id] as const,
    queryFn: () =>
      subject === 'task'
        ? call(api.GET('/api/tasks/{id}/following', { params: { path: { id } } }))
        : call(api.GET('/api/content/posts/{id}/following', { params: { path: { id } } })),
  });

export function useSetFollowing(target: FollowTarget) {
  const queryClient = useQueryClient();
  const { subject, id } = target;
  return useMutation({
    mutationFn: (following: boolean) =>
      subject === 'task'
        ? call(
            api.PUT('/api/tasks/{id}/following', {
              params: { path: { id } },
              body: { following },
            }),
          )
        : call(
            api.PUT('/api/content/posts/{id}/following', {
              params: { path: { id } },
              body: { following },
            }),
          ),
    onSuccess: (result: Following) =>
      queryClient.setQueryData(followingQuery(target).queryKey, result),
  });
}
