import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { IconButton } from './icon-button';

interface CarouselProps extends Omit<ComponentProps<'section'>, 'children'> {
  /** One node per slide, in order. */
  slides: ReactNode[];
  /** Names the carousel for assistive technology. */
  label: string;
  previousLabel: string;
  nextLabel: string;
  /** "Slide 2 of 5", for each slide. */
  slideLabel: (index: number, total: number) => string;
  /** On each slide's frame (its size and ratio). */
  slideClassName?: string;
}

/**
 * Slides to swipe through, one at a time: scroll snap for touch and trackpads, buttons and dots
 * for the rest. The reading direction decides which way "next" goes, so it works in RTL as is.
 */
function Carousel({
  slides,
  label,
  previousLabel,
  nextLabel,
  slideLabel,
  slideClassName,
  className,
  ...props
}: CarouselProps) {
  const track = useRef<HTMLUListElement>(null);
  const [current, setCurrent] = useState(0);
  const total = slides.length;

  // The slide most in view is the current one.
  useEffect(() => {
    const list = track.current;
    // Observed again when the slides change; one slide has nothing to follow.
    if (!list || total < 2 || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setCurrent(Number((entry.target as HTMLElement).dataset.index));
        }
      },
      { root: list, threshold: 0.6 },
    );
    for (const item of list.children) observer.observe(item);
    return () => observer.disconnect();
  }, [total]);

  const go = (index: number) => {
    const target = track.current?.children[index] as HTMLElement | undefined;
    if (!target || !track.current) return;
    // Scrolls the track only, never the page.
    const list = track.current;
    list.scrollTo({
      left:
        list.scrollLeft + target.getBoundingClientRect().left - list.getBoundingClientRect().left,
      behavior: 'smooth',
    });
    setCurrent(index);
  };

  return (
    <section
      data-slot="carousel"
      aria-roledescription="carousel"
      aria-label={label}
      className={cn('relative flex flex-col gap-2', className)}
      {...props}
    >
      <ul
        ref={track}
        className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, index) => (
          <li
            // Slides are positional: their order is their identity.
            // biome-ignore lint/suspicious/noArrayIndexKey: the index is the slide's place
            key={index}
            data-index={index}
            aria-roledescription="slide"
            aria-label={slideLabel(index + 1, total)}
            className={cn('w-full shrink-0 snap-start', slideClassName)}
          >
            {slide}
          </li>
        ))}
      </ul>
      {total > 1 && (
        <>
          <CarouselButton
            label={previousLabel}
            disabled={current === 0}
            className="start-2"
            onClick={() => go(current - 1)}
          >
            <ChevronRightIcon className="ltr:-scale-x-100" />
          </CarouselButton>
          <CarouselButton
            label={nextLabel}
            disabled={current === total - 1}
            className="end-2"
            onClick={() => go(current + 1)}
          >
            <ChevronLeftIcon className="ltr:-scale-x-100" />
          </CarouselButton>
          <div aria-hidden="true" className="flex justify-center gap-1.5">
            {slides.map((_, index) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: one dot per slide place
                key={index}
                className={cn(
                  'size-1.5 rounded-full transition-colors duration-150 ease-out',
                  index === current ? 'bg-primary' : 'bg-border',
                )}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function CarouselButton({ className, ...props }: ComponentProps<typeof IconButton>) {
  return (
    <IconButton
      variant="outline"
      className={cn(
        'absolute top-[calc(50%-1.25rem)] -translate-y-1/2 rounded-full bg-surface disabled:pointer-events-none disabled:opacity-0',
        className,
      )}
      {...props}
    />
  );
}

export { Carousel, type CarouselProps };
