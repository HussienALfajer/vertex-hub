import { useEffect, useRef } from 'react';

/**
 * When `state` changes (a record's status, a list's length) and the change took the focused control
 * off the page, the focus goes to `target()` instead of staying on the page body. It covers what a
 * dialog's `finalFocus` cannot: a menu item that leaves the focus on the body, or a list that
 * refreshes after the dialog has already given the focus back.
 */
export function useFocusAfterChange(state: string | number, target: () => HTMLElement | null) {
  const shown = useRef(state);
  useEffect(() => {
    if (shown.current === state) return;
    shown.current = state;
    if (document.activeElement === document.body) target()?.focus();
  });
}
