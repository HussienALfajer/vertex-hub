import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertex-hub/ui';

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
}: {
  items: Choice[];
  value: string | null;
  onChange: (value: string) => void;
  labelledBy?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      items={items}
      value={value}
      disabled={disabled}
      onValueChange={(next) => next !== null && onChange(next)}
    >
      <SelectTrigger aria-labelledby={labelledBy} aria-label={label} className={className}>
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
