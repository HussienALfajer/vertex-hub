import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { unreadCountQuery } from '../notifications/notifications.queries';
import { closeReadPushes, resumePushOnSession } from '../notifications/push.queries';

/**
 * The shell's side of the installed app (F16 part A), run once per signed-in user: the icon badge
 * (rule A4), the subscription on the new session (edge case 3) and the pushes read elsewhere
 * (rule A14). Pushes clicked while a window is open are followed in `followPushClicks`.
 */
export function useInstalledApp(userId: string) {
  const queryClient = useQueryClient();
  const unread = useQuery(unreadCountQuery);
  const count = unread.data?.count;

  useEffect(() => {
    if (count === undefined) return;
    const badge = navigator as Navigator & Partial<NavigatorBadge>;
    // Platforms without badges have neither method; a refusal changes nothing else.
    const set = count > 0 ? badge.setAppBadge?.(count) : badge.clearAppBadge?.();
    set?.catch(() => undefined);
  }, [count]);

  useEffect(() => {
    if (!userId) return;
    void resumePushOnSession(queryClient);
    void closeReadPushes();
    const onFocus = () => void closeReadPushes();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [userId, queryClient]);
}
