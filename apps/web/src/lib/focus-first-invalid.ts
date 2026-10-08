import { type RefObject, useEffect } from 'react';

/**
 * Focuses the first invalid control of a form whose errors live in component state rather than in
 * React Hook Form (which focuses its own fields): the control the user has to fix first.
 */
export function focusFirstInvalid(form: HTMLElement | null): void {
  const invalid = form?.querySelectorAll<HTMLElement>('[aria-invalid="true"]') ?? [];
  // A select also marks the input it keeps for form data, which is out of the tab order.
  [...invalid].find((control) => control.tabIndex >= 0)?.focus();
}

/**
 * React Hook Form focuses the first error in the order fields registered, and a form registers its
 * own inputs before the `Controller`s of its children. With `shouldFocusError: false`, this focuses
 * the first invalid control on the page after each submit instead.
 */
export function useFocusFirstError(submitCount: number, form: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (submitCount > 0) focusFirstInvalid(form.current);
  }, [submitCount, form]);
}
