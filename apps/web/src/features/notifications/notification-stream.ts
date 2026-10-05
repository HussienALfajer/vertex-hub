import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { type NotificationStreamEvent, notificationStreamEventSchema } from '@vertex-hub/contracts';
import { toast } from '@vertex-hub/ui';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';
import { useDepartmentNames } from '../projects/project-badges';
import { notificationLink, notificationText } from './notification-content';
import { applyStreamEvent, refreshNotifications, useMarkRead } from './notifications.queries';

const STREAM_URL = '/api/me/notifications/stream';
const TOAST_MS = 6000;
/** More than this many notifications within the burst window collapse into one toast. */
const BURST_LIMIT = 3;
const BURST_MS = 2000;
/** After the server refuses the stream (the session ended), try again this much later. */
const RETRY_MS = 30_000;

interface Burst {
  start: number;
  count: number;
  toastIds: string[];
  summaryId?: string;
}

/**
 * The live push (F14 rule 4, ADR 0018), opened once by the shell's bell: each `notification`
 * event updates the query cache and shows a toast (rule 16). On reconnect and on window focus the
 * count and lists refetch, so nothing is lost while the stream was down.
 */
export function useNotificationStream(openBell: () => void) {
  const queryClient = useQueryClient();
  const onEvent = useEventToast(openBell);
  const latest = useRef(onEvent);
  latest.current = onEvent;

  useEffect(() => {
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let connected = false;
    const refresh = () => void refreshNotifications(queryClient);

    const connect = () => {
      source = new EventSource(STREAM_URL);
      source.addEventListener('open', () => {
        // The first connection needs nothing: the queries load on their own.
        if (connected) refresh();
        connected = true;
      });
      source.addEventListener('notification', (message) => {
        const event = parseStreamEvent((message as MessageEvent<string>).data);
        // An event this version cannot read (malformed, or from a newer API) still counts:
        // the lists are fetched again instead.
        if (!event) {
          refresh();
          return;
        }
        void applyStreamEvent(queryClient, event);
        latest.current(event);
      });
      source.addEventListener('error', () => {
        // EventSource retries dropped connections itself; it gives up only on an error status.
        if (source?.readyState !== EventSource.CLOSED) return;
        refresh();
        retry = setTimeout(connect, RETRY_MS);
      });
    };

    connect();
    window.addEventListener('focus', refresh);
    return () => {
      source?.close();
      clearTimeout(retry);
      window.removeEventListener('focus', refresh);
    };
  }, [queryClient]);
}

function useEventToast(openBell: () => void) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const departmentName = useDepartmentNames();
  const markRead = useMarkRead();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const burst = useRef<Burst | null>(null);

  return (event: NotificationStreamEvent) => {
    // The notifications page updates its list instead.
    if (pathname === '/notifications') return;
    const now = Date.now();
    if (!burst.current || now - burst.current.start > BURST_MS) {
      burst.current = { start: now, count: 0, toastIds: [] };
    }
    const current = burst.current;
    current.count += 1;

    if (current.count > BURST_LIMIT) {
      const summary = {
        title: t('notifications.newMany', {
          count: current.count,
          n: formatNumber(current.count),
        }),
        timeout: TOAST_MS,
      };
      if (current.summaryId) {
        toast.update(current.summaryId, summary);
        return;
      }
      for (const id of current.toastIds) toast.close(id);
      const summaryId = toast.add({
        ...summary,
        type: 'info',
        actionProps: {
          children: t('notifications.open'),
          onClick: () => {
            toast.close(summaryId);
            openBell();
          },
        },
      });
      current.summaryId = summaryId;
      return;
    }

    const { notification } = event;
    const { text, context } = notificationText(notification, departmentName);
    const id = toast.add({
      title: text,
      description: context ?? undefined,
      type: 'info',
      timeout: TOAST_MS,
      actionProps: {
        children: t('notifications.open'),
        onClick: () => {
          toast.close(id);
          markRead.mutate(notification.id);
          void navigate(notificationLink(notification));
        },
      },
    });
    current.toastIds.push(id);
  };
}

/** A pushed event checked against the contract, or null. */
function parseStreamEvent(data: string): NotificationStreamEvent | null {
  try {
    const parsed = notificationStreamEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
