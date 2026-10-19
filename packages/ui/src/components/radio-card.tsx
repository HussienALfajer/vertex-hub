import { Radio as RadioPrimitive } from '@base-ui/react/radio';
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * A choice between a few options that each need a sentence of explanation. The group needs an
 * accessible name (`aria-label` or `aria-labelledby`).
 */
function RadioGroup<Value>({ className, ...props }: RadioGroupPrimitive.Props<Value>) {
  return (
    <RadioGroupPrimitive<Value>
      data-slot="radio-group"
      className={cn('grid gap-2', className)}
      {...props}
    />
  );
}

/** One option of a `RadioGroup`: a bordered card with a dot, a title and an optional hint. */
function RadioCard<Value>({
  className,
  title,
  description,
  ...props
}: Omit<RadioPrimitive.Root.Props<Value>, 'title' | 'children'> & {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <RadioPrimitive.Root<Value>
      data-slot="radio-card"
      className={cn(
        'group flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface p-3 text-start',
        'transition-colors duration-150 ease-out hover:bg-muted',
        'data-checked:border-primary data-checked:bg-muted',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:bg-surface',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-input bg-surface group-data-checked:border-primary"
      >
        <RadioPrimitive.Indicator className="size-2.5 rounded-full bg-primary data-unchecked:hidden" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {description && <span className="text-sm text-muted-foreground">{description}</span>}
      </span>
    </RadioPrimitive.Root>
  );
}

export { RadioCard, RadioGroup };
