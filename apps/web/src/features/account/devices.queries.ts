import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, call } from '../../lib/api/client';
import { hardwareSignals } from './hardware';

export const devicesKeys = {
  all: ['devices'] as const,
  list: ['devices', 'list'] as const,
};

/** F01B: the user's open sessions, kept fresh while the page is open. */
export const devicesQuery = queryOptions({
  queryKey: devicesKeys.list,
  queryFn: () => call(api.GET('/api/me/sessions')),
  refetchInterval: 60_000,
  refetchOnWindowFocus: 'always',
});

/**
 * Rule 5: reports the hardware of the current session. The API keeps the first report of a
 * session, so a later one changes nothing; a failure is left for the next app load.
 */
export async function reportHardware(): Promise<void> {
  try {
    await api.PUT('/api/me/sessions/current/hardware', { body: hardwareSignals() });
  } catch {
    // The hardware key only adds "another browser" matches; nothing waits for it.
  }
}

/** A sign-out writes an audit entry on the user (rule 12). */
function useInvalidateDevices() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: devicesKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['audit'] }),
    ]);
}

export function useSignOutDevice() {
  const invalidate = useInvalidateDevices();
  return useMutation({
    mutationFn: (id: string) =>
      call(api.DELETE('/api/me/sessions/{id}', { params: { path: { id } } })),
    onSettled: invalidate,
  });
}

/** With `includeCurrent` the session ends here too; the caller leaves the app. */
export function useSignOutAllDevices() {
  return useMutation({
    mutationFn: (includeCurrent: boolean) =>
      call(api.POST('/api/me/sessions/sign-out-all', { body: { includeCurrent } })),
  });
}
