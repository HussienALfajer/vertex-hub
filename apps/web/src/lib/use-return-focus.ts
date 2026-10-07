import { type RefObject, useMemo, useRef } from 'react';

/**
 * Where the focus goes when a dialog closes or an action ends: back to the button that started it,
 * or to `fallback` when the change took that button off the page (an archived row, a lead that
 * was lost, a meeting that was cancelled).
 */
export interface ReturnFocus {
  /** Remembers the button that started a dialog or an action. */
  from: (opener: HTMLElement | null) => void;
  /** The element to focus now: a dialog's `finalFocus`. */
  target: () => HTMLElement | null;
  /** Focuses the fallback, after a change that always takes the button off the page. */
  toFallback: () => void;
}

export function useReturnFocus(fallback: RefObject<HTMLElement | null>): ReturnFocus {
  const opener = useRef<HTMLElement | null>(null);
  return useMemo(
    () => ({
      from: (element) => {
        opener.current = element;
      },
      target: () => (opener.current?.isConnected ? opener.current : fallback.current),
      toFallback: () => fallback.current?.focus(),
    }),
    [fallback],
  );
}
