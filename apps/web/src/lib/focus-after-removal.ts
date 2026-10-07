/**
 * A row left with its remove button (`data-focus="remove"`): the focus goes to the next row's
 * button, the previous one's when it was the last, or `fallback` when none is left. Call it after
 * the row is gone from the page (`flushSync` around the removal).
 */
export function focusAfterRemoval(
  list: HTMLElement | null,
  position: number,
  fallback: HTMLElement | null,
) {
  const buttons = list?.querySelectorAll<HTMLElement>('[data-focus="remove"]') ?? [];
  (buttons[Math.min(position, buttons.length - 1)] ?? fallback)?.focus();
}
