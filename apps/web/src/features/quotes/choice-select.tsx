import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertex-hub/ui';
import type { Ref } from 'react';

export interface Choice {
  value: string;
  label: string;
}

/** A select over a short list of choices, named by its visible label or by `aria-label`. */
export function ChoiceSelect({
  items,
  value,
  onChange,
  labelledBy,
  label,
  placeholder,
  disabled,
  className,
  ref,
}: {
  items: Choice[];
  value: string | null;
  onChange: (value: string) => void;
  labelledBy?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** The trigger, for the focus to come back to it on an error. */
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <Select
      items={items}
      value={value}
      disabled={disabled}
      onValueChange={(next) => next !== null && onChange(next)}
    >
      <SelectTrigger
        ref={ref}
        aria-labelledby={labelledBy}
        aria-label={label}
        className={className}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
