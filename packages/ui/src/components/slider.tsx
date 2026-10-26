import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import { cn } from '../lib/cn';

type SliderProps = Omit<SliderPrimitive.Root.Props<number>, 'children'> & {
  /** The accessible name of the thumb, which the slider has no visible label for. */
  thumbLabel: string;
  /** The value as read out, such as "150%". */
  valueText?: (value: number) => string;
};

/** One value picked along a range by dragging or with the arrow keys (an image's zoom). */
function Slider({ className, thumbLabel, valueText, ...props }: SliderProps) {
  return (
    <SliderPrimitive.Root data-slot="slider" className={cn('w-full', className)} {...props}>
      <SliderPrimitive.Control className="flex h-6 w-full touch-none items-center select-none">
        <SliderPrimitive.Track className="relative h-1.5 w-full rounded-sm bg-muted">
          <SliderPrimitive.Indicator className="rounded-sm bg-primary" />
          <SliderPrimitive.Thumb
            getAriaLabel={() => thumbLabel}
            getAriaValueText={valueText ? (_text, value) => valueText(value) : undefined}
            className={cn(
              'size-4.5 rounded-full border-2 border-primary bg-surface shadow-float',
              // The focus lands on the thumb's hidden input: the thumb shows the one focus ring.
              'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
              'data-dragging:scale-110 transition-transform duration-150 ease-out motion-reduce:transition-none',
            )}
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider, type SliderProps };
