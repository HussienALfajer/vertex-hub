import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { Input } from './input';

interface ColorSwatchProps extends Omit<ComponentProps<'span'>, 'color'> {
  /**
   * A color from the data, such as a client's brand color (`#RRGGBB`). The design system's own
   * colors come from tokens; only colors that are content are painted with this component.
   */
  color: string;
}

/** A flat square of a content color with a hairline, so light colors stay visible on white. */
function ColorSwatch({ color, className, style, ...props }: ColorSwatchProps) {
  return (
    <span
      data-slot="color-swatch"
      aria-hidden="true"
      className={cn('inline-block size-6 shrink-0 rounded-sm border border-border', className)}
      style={{ ...style, backgroundColor: color }}
      {...props}
    />
  );
}

interface ColorStripProps extends ComponentProps<'div'> {
  colors: readonly string[];
}

/** Content colors side by side in one bar, such as a brand palette at the edge of a card; a repeated color shows once. */
function ColorStrip({ colors, className, ...props }: ColorStripProps) {
  return (
    <div
      data-slot="color-strip"
      aria-hidden="true"
      className={cn('flex h-1.5 w-full overflow-hidden', className)}
      {...props}
    >
      {[...new Set(colors)].map((color) => (
        <span key={color} className="h-full flex-1" style={{ backgroundColor: color }} />
      ))}
    </div>
  );
}

/** A complete `#RRGGBB` color, the only form a native color picker accepts. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

interface ColorInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Accessible name of the swatch that opens the system color picker. */
  pickLabel: string;
  invalid?: boolean;
  className?: string;
}

/**
 * A color as `#RRGGBB` text, with a swatch that previews it and opens the system color picker.
 * Hex codes are typed or pasted from brand guidelines; the picker is for finding a color.
 */
function ColorInput({
  id,
  value,
  onChange,
  onBlur,
  pickLabel,
  invalid,
  className,
}: ColorInputProps) {
  const complete = HEX_COLOR.test(value);
  return (
    <div data-slot="color-input" className={cn('flex items-center gap-2', className)}>
      <label
        title={pickLabel}
        className="relative flex size-9 shrink-0 cursor-pointer rounded-md border border-input p-1 transition-colors duration-150 ease-out focus-within:border-primary hover:bg-muted"
      >
        <span className="sr-only">{pickLabel}</span>
        {complete ? (
          <ColorSwatch color={value} className="size-full border-0" />
        ) : (
          <span className="size-full rounded-sm bg-muted" />
        )}
        <input
          // Re-created when the text changes, so the picker opens on the typed color.
          key={complete ? value : 'empty'}
          type="color"
          defaultValue={complete ? value.toLowerCase() : undefined}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
      <Input
        id={id}
        dir="ltr"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        maxLength={7}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid || undefined}
        className="text-end tabular-nums"
      />
    </div>
  );
}

export {
  ColorInput,
  type ColorInputProps,
  ColorStrip,
  type ColorStripProps,
  ColorSwatch,
  type ColorSwatchProps,
};
