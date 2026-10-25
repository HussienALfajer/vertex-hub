import {
  type PersistedClient,
  type Persister,
  persistQueryClientRestore,
  persistQueryClientSubscribe,
} from '@tanstack/query-persist-client-core';
import { onlineManager, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { del, get, set } from 'idb-keyval';
import { IMAGE_CACHE } from '../service-worker/image-cache';

/*
 * F16 rule A5 (ADR 0036): the query cache is kept in IndexedDB for 7 days, so the installed app
 * opens offline with the last data. Financial data is never kept: only the queries listed here
 * are, and none of them answers with an amount (invoices, payments, quotes, retainers, campaigns,
 * catalog prices, leads' budgets, the finance dashboard and the audit log stay out). A query
 * added later stays out until it is listed.
 */
const OFFLINE_QUERIES: readonly (readonly string[])[] = [
  ['me'],
  // Not the client page's answers: they are keyed by the link's token.
  ['approvals', 'ready'],
  ['approvals', 'requests'],
  ['approvals', 'request'],
  ['approvals', 'client'],
  // Not the home answer: the critical dialog must not ask for an acknowledgement offline.
  ['announcements', 'list'],
  ['announcements', 'detail'],
  ['calendar'],
  ['clients'],
  ['content'],
  ['departments'],
  ['devices'],
  ['emails'],
  ['files'],
  ['tasks'],
  ['templates'],
  ['users'],
  // The detail adds the project's money for money readers; the list has none.
  ['projects', 'list'],
  // Some notification texts hold amounts (`ad_budget_low`, `retainer_amendment_pending`).
  ['notifications', 'unread-count'],
  ['notifications', 'settings'],
  ['reports', 'dashboard', 'departments'],
  ['reports', 'productivity'],
];

/** Whether a query may be kept on the device (rule A5). */
export function isOfflineQuery(queryKey: QueryKey): boolean {
  return OFFLINE_QUERIES.some((prefix) => prefix.every((part, index) => queryKey[index] === part));
}

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Kept queries stay in memory as long as on the device, so the next save keeps them. */
export const OFFLINE_GC_MS = MAX_AGE_MS;
const STORE_KEY = 'vertex-hub-query-cache';
/** A new version starts from an empty cache: the shapes it reads may have changed. */
const BUSTER = import.meta.env.VITE_BUILD_ID ?? 'dev';
/** A blocked or broken IndexedDB must not keep the app from starting. */
const RESTORE_TIMEOUT_MS = 2000;

/** The library saves on every cache event; the device is written at most once a second. */
const SAVE_DELAY_MS = 1000;
let pendingSave: { client: PersistedClient; timer: ReturnType<typeof setTimeout> } | null = null;

const persister: Persister = {
  persistClient: (client: PersistedClient) => {
    if (pendingSave) {
      pendingSave.client = client;
      return;
    }
    const save = {
      client,
      timer: setTimeout(() => {
        pendingSave = null;
        void set(STORE_KEY, save.client).catch(() => undefined);
      }, SAVE_DELAY_MS),
    };
    pendingSave = save;
  },
  restoreClient: () => get<PersistedClient>(STORE_KEY),
  removeClient: () => {
    // A save still waiting would bring the erased data back.
    if (pendingSave) clearTimeout(pendingSave.timer);
    pendingSave = null;
    return del(STORE_KEY);
  },
};

/** Fills the cache from the device before the first render; nothing kept means nothing to do. */
export async function restoreOfflineCache(queryClient: QueryClient): Promise<void> {
  try {
    await Promise.race([
      persistQueryClientRestore({ queryClient, persister, maxAge: MAX_AGE_MS, buster: BUSTER }),
      new Promise((resolve) => setTimeout(resolve, RESTORE_TIMEOUT_MS)),
    ]);
  } catch {
    // An unreadable cache is dropped by the restore itself; the app loads from the API.
  }
}

/**
 * Saves the listed queries after each change. The kept data belongs to the user it was loaded
 * for: when the session answers with someone else, the rest of the cache is dropped before it can
 * show; when it answers with no one, the device's copy goes (`leaveSession` and `loadMe` empty the
 * memory, once the pages that read it are gone).
 */
export function keepOfflineCache(queryClient: QueryClient): void {
  let owner = userIdOf(queryClient.getQueryData(['me']));
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    if (event.query.queryKey[0] !== 'me') return;
    const user = userIdOf(event.query.state.data);
    if (user === owner) return;
    const previous = owner;
    owner = user;
    void clearOfflineCache();
    if (user !== null && previous !== null) {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
    }
  });
  persistQueryClientSubscribe({
    queryClient,
    persister,
    buster: BUSTER,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) =>
        query.state.status === 'success' && isOfflineQuery(query.queryKey),
      // A change waiting for the connection holds what the user typed, amounts included.
      shouldDehydrateMutation: () => false,
    },
  });
}

function userIdOf(me: unknown): string | null {
  return (me as { user?: { id?: string } } | null | undefined)?.user?.id ?? null;
}

/** Rule A5: erased on sign-out, on a refused session, and before another user's data. */
export async function clearOfflineCache(): Promise<void> {
  try {
    await persister.removeClient();
  } catch {
    // Nothing kept, or storage unavailable: nothing to erase.
  }
  try {
    // The service worker's photos and logos (F01C rule 13).
    await globalThis.caches?.delete(IMAGE_CACHE);
  } catch {
    // No Cache Storage (an insecure origin, a private window): nothing kept.
  }
}

/**
 * Offline, a page reads what the cache holds and nothing more: kept data is not refetched (a
 * failed refetch would hide it behind an error), and a query with no data fails at once, so its
 * page says "Not available offline" (`LoadError`) instead of loading forever. Online, the app's
 * own defaults apply again and the failed queries load.
 */
export function followConnection(queryClient: QueryClient): void {
  const online = queryClient.getDefaultOptions().queries ?? {};
  const apply = (isOnline: boolean) =>
    queryClient.setDefaultOptions({
      ...queryClient.getDefaultOptions(),
      queries: isOnline
        ? online
        : {
            ...online,
            networkMode: 'always',
            retry: false,
            refetchOnMount: false,
            refetchOnWindowFocus: false,
          },
    });
  // The query client starts online and learns only from later events; an app opened offline
  // says so from the start (`navigator.onLine` is false only when there is surely no network).
  if (!navigator.onLine) onlineManager.setOnline(false);
  apply(onlineManager.isOnline());
  onlineManager.subscribe(apply);
}
