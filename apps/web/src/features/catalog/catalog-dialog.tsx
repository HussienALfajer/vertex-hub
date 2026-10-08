import type { DialogContent } from '@vertex-hub/ui';
import type { ComponentProps } from 'react';

/** `null` while closed, `'new'` to add, or the record being edited. */
export type Editing<T> = T | 'new' | null;

/** The service and package dialogs: what they edit, and where the focus goes when they close. */
export interface CatalogDialogProps<T> {
  editing: Editing<T>;
  onClose: () => void;
  finalFocus: ComponentProps<typeof DialogContent>['finalFocus'];
}
