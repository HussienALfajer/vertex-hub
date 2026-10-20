import { type QueryClient, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, call } from '../../lib/api/client';
import { readPushData } from '../../service-worker/push-payload';
import { devicesKeys } from '../account/devices.queries';
import {
  type PushDeviceState,
  readPushDevice,
  resumePush,
  turnOffPush,
  turnOnPush,
} from './push-device';

export const pushKeys = {
  config: ['notifications', 'push', 'config'] as const,
  /** This browser's permission and subscription, read from the browser. */
  device: ['notifications', 'push', 'device'] as const,
};

/** Rule A16: without VAPID keys on the server, push is unavailable and its controls hide. */
export const pushConfigQuery = queryOptions({
  queryKey: pushKeys.config,
  queryFn: () => call(api.GET('/api/me/push/config')),
  staleTime: Number.POSITIVE_INFINITY,
});

export const pushDeviceQuery = queryOptions({
  queryKey: pushKeys.device,
  queryFn: readPushDevice,
  // The permission can change in the browser's settings while the app is open.
  refetchOnWindowFocus: 'always',
});

function useRefreshPush() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: pushKeys.device }),
      queryClient.invalidateQueries({ queryKey: devicesKeys.all }),
    ]);
}

async function vapidKey(queryClient: QueryClient): Promise<string> {
  const config = await queryClient.ensureQueryData(pushConfigQuery);
  if (!config.vapidPublicKey) throw new Error('Push is unavailable');
  return config.vapidPublicKey;
}

/** Rule A7: asks the browser, subscribes, and stores the subscription on this session. */
export function useTurnOnPush() {
  const queryClient = useQueryClient();
  const refresh = useRefreshPush();
  return useMutation({
    mutationFn: async (): Promise<PushDeviceState> => {
      const result = await turnOnPush(await vapidKey(queryClient));
      if (typeof result === 'string') return result;
      await call(api.PUT('/api/me/push/subscription', { body: result }));
      return 'on';
    },
    onSettled: refresh,
  });
}

export function useTurnOffPush() {
  const refresh = useRefreshPush();
  return useMutation({
    mutationFn: async () => {
      await turnOffPush();
      await call(api.DELETE('/api/me/push/subscription'));
    },
    onSettled: refresh,
  });
}

/** Rule A12: at most one a minute (429). */
export function useTestPush() {
  return useMutation({ mutationFn: () => call(api.POST('/api/me/push/test')) });
}

/**
 * Edge case 3: a device that allowed notifications subscribes again on the new session, without
 * asking. A failure is left for the next app load.
 */
export async function resumePushOnSession(queryClient: QueryClient): Promise<void> {
  try {
    const config = await queryClient.ensureQueryData(pushConfigQuery);
    if (!config.available || !config.vapidPublicKey) return;
    const input = await resumePush(config.vapidPublicKey);
    if (input) await call(api.PUT('/api/me/push/subscription', { body: input }));
  } catch {
    // Nothing waits for it; the user can still turn push on by hand.
  }
  void queryClient.invalidateQueries({ queryKey: pushKeys.device });
}

/** The most unread notifications one request returns (the list's page limit). */
const UNREAD_PAGE = 100;

/**
 * Rule A14: when the app opens or regains focus, the pushes still on the screen whose
 * notification was read or resolved elsewhere are closed.
 */
export async function closeReadPushes(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const shown = (await registration?.getNotifications()) ?? [];
    const withNotification = shown.filter((push) => readPushData(push.data)?.notificationId);
    if (withNotification.length === 0) return;
    const unread = await call(
      api.GET('/api/me/notifications', {
        params: { query: { unread: 'true', pageSize: UNREAD_PAGE } },
      }),
    );
    // Beyond one page the list is incomplete: closing could hide unread ones.
    if (unread.total > unread.items.length) return;
    const unreadIds = new Set(unread.items.map((item) => item.id));
    for (const push of withNotification) {
      const id = readPushData(push.data)?.notificationId;
      if (id && !unreadIds.has(id)) push.close();
    }
  } catch {
    // Best effort (ADR 0036): the next push closes them anyway.
  }
}
