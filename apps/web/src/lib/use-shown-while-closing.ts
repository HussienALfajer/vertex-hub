import { useState } from 'react';

/**
 * The last value a dialog opened with (`null` while closed). It stays while the dialog fades out
 * after closing, so its title and fields do not change during the exit animation.
 */
export function useShownWhileClosing<T>(value: T | null): T | null {
  const [shown, setShown] = useState(value);
  if (value !== null && value !== shown) setShown(value);
  return shown;
}
