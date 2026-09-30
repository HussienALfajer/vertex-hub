import { useEffect, useState } from 'react';

/** How long typing pauses before a search runs. */
export const SEARCH_DELAY_MS = 300;

/** `value`, once it has stopped changing for `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs = SEARCH_DELAY_MS): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

/**
 * The text of a list's search box, kept in step with the URL's `search` param: typing updates
 * the URL after a pause (no request per keystroke), and a URL change from outside (a sidebar
 * link clearing the search) updates the box.
 */
export function useSearchText(
  search: string | undefined,
  onChange: (next: { search: string | undefined }) => void,
): [string, (text: string) => void] {
  const [text, setText] = useState(search ?? '');
  useEffect(() => setText(search ?? ''), [search]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((search ?? '') !== text.trim()) onChange({ search: text.trim() || undefined });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, search, onChange]);
  return [text, setText];
}
