import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { DirectionProvider, Toaster } from '@vertex-hub/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { catchInstallPrompt } from './features/app/install';
import { followPushClicks } from './features/app/push-clicks';
import i18n from './i18n';
import { ApiError } from './lib/api/client';
import { leaveSession } from './lib/auth';
import {
  followConnection,
  keepOfflineCache,
  OFFLINE_GC_MS,
  restoreOfflineCache,
} from './lib/offline-cache';
import { routeTree } from './routeTree.gen';
import './styles.css';

/**
 * Reacts to access changes found by any request (F01 edge cases 2-4): a user who must set up 2FA
 * goes to the setup page; any other 403 means permissions changed, so the session is reloaded;
 * a 401 means the session ended.
 */
function onApiError(error: Error) {
  if (!(error instanceof ApiError)) return;
  if (error.status === 403 && error.code === 'TWO_FACTOR_REQUIRED') {
    void router.navigate({ to: '/setup-two-factor' });
  } else if (error.status === 403) {
    void queryClient.invalidateQueries({ queryKey: ['me'] });
  } else if (error.status === 401 && !sessionEnding) {
    // Back to the same page after signing in again (WEB-03); the cache goes with the session.
    sessionEnding = true;
    const location = router.state.location;
    const redirect = location.pathname === '/login' ? undefined : location.href;
    // F01B: a session refused while the app was open was signed out from another device.
    void leaveSession(queryClient, () =>
      router.navigate({
        to: '/login',
        search: redirect ? { redirect, signedOut: 'elsewhere' } : {},
      }),
    ).finally(() => {
      sessionEnding = false;
    });
  }
}

/** Several requests fail with 401 at once when a session ends: handle it once. */
let sessionEnding = false;

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    queries: {
      // F16 rule A5: what the device keeps stays in memory as long, so each save keeps it.
      gcTime: OFFLINE_GC_MS,
      // Do not retry what the server refused on purpose.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) && failureCount < 2,
    },
  },
});

// F16: the browser offers the install once, early; the app keeps the offer for its button.
catchInstallPrompt();
followConnection(queryClient);
await restoreOfflineCache(queryClient);
keepOfflineCache(queryClient);

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
});

followPushClicks(router);

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

document.title = i18n.t('app.name');

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <DirectionProvider direction="rtl">
      <QueryClientProvider client={queryClient}>
        <Toaster closeLabel={i18n.t('common.close')}>
          <RouterProvider router={router} />
        </Toaster>
      </QueryClientProvider>
    </DirectionProvider>
  </StrictMode>,
);
