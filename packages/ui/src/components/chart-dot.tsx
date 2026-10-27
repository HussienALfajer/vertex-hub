import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

const chartDotVariants = cva('inline-block size-2.5 shrink-0 rounded-full', {
  variants: {
    color: {
      chart_1: 'bg-chart-1',
      chart_2: 'bg-chart-2',
      chart_3: 'bg-chart-3',
      chart_4: 'bg-chart-4',
      chart_5: 'bg-chart-5',
      chart_6: 'bg-chart-6',
      chart_7: 'bg-chart-7',
      chart_8: 'bg-chart-8',
    },
    /** An archived series stays visible, faded. */
    muted: { true: 'opacity-40' },
  },
});

type ChartDotProps = Omit<ComponentProps<'span'>, 'color'> &
  VariantProps<typeof chartDotVariants> & {
    color: NonNullable<VariantProps<typeof chartDotVariants>['color']>;
  };

/** A data series' color at a glance, such as a content pillar's; its name is shown beside it. */
function ChartDot({ color, muted, className, ...props }: ChartDotProps) {
  return (
    <span
      data-slot="chart-dot"
      aria-hidden="true"
      className={cn(chartDotVariants({ color, muted }), className)}
      {...props}
    />
  );
}

export { ChartDot, type ChartDotProps };
