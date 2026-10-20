import type { AnyRouter } from '@tanstack/react-router';
import { appPath, type OpenMessage } from '../../service-worker/push-payload';

/**
 * F16 rule A10: a push clicked while a window of the app is open focuses it and leads it to the
 * notification's link, on any page (the shell, the sign-in page, a client approval page).
 */
export function followPushClicks(router: AnyRouter): void {
  navigator.serviceWorker?.addEventListener(
    'message',
    (event: MessageEvent<OpenMessage | null>) => {
      if (event.data?.type !== 'open') return;
      const path = appPath(event.data.link, window.location.origin);
      if (path) router.history.push(path);
    },
  );
}
