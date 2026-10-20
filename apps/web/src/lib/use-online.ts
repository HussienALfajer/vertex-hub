import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/** Whether the device has a connection, as the query client sees it (F16 rule A5). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => onlineManager.subscribe(listener),
    () => onlineManager.isOnline(),
  );
}
