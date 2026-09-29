import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

/** Multi-line text. It grows with its content (`field-sizing`), from three lines up. */
function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'field-sizing-content min-h-24 w-full min-w-0 rounded-md border border-input bg-surface px-3 py-2 text-base text-foreground',
        'transition-colors duration-150 ease-out placeholder:text-muted-foreground',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive-text',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
