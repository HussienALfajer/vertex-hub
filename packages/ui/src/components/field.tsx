import { Field as FieldPrimitive } from '@base-ui/react/field';
import { cn } from '../lib/cn';

/**
 * A form row on Base UI's Field: the label, description and error are linked to the control
 * (an `Input` or `Select` placed inside) through ids and aria attributes automatically.
 */
function Field({ className, ...props }: FieldPrimitive.Root.Props) {
  return (
    <FieldPrimitive.Root
      data-slot="field"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: FieldPrimitive.Label.Props) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      className={cn('text-sm font-medium text-foreground select-none', className)}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: FieldPrimitive.Description.Props) {
  return (
    <FieldPrimitive.Description
      data-slot="field-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

/** Pass `match` to show it: `true` for errors computed outside the browser's validity API. */
function FieldError({ className, ...props }: FieldPrimitive.Error.Props) {
  return (
    <FieldPrimitive.Error
      data-slot="field-error"
      className={cn('text-sm text-destructive-text', className)}
      {...props}
    />
  );
}

export { Field, FieldDescription, FieldError, FieldLabel };
