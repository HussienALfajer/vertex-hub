import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import type { WorkflowStatus } from '@vertex-hub/contracts';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const badgeVariants = cva(
  'inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-sm px-2 text-xs font-medium whitespace-nowrap [&>svg]:size-3.5',
  {
    variants: {
      tone: {
        neutral: 'bg-status-neutral text-status-neutral-foreground',
        info: 'bg-status-info text-status-info-foreground',
        gold: 'bg-status-gold text-status-gold-foreground',
        warning: 'bg-status-warning text-status-warning-foreground',
        danger: 'bg-status-danger text-status-danger-foreground',
        success: 'bg-status-success text-status-success-foreground',
        brand: 'bg-status-brand text-status-brand-foreground',
        outline: 'border border-border text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

type BadgeProps = useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

function Badge({ className, tone, render, ...props }: BadgeProps) {
  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>({ className: cn(badgeVariants({ tone }), className) }, props),
    state: { slot: 'badge', tone },
  });
}

/** Workflow status colors (brand/identity.md §2). */
const workflowStatusTone = {
  new: 'neutral',
  in_progress: 'info',
  internal_review: 'gold',
  awaiting_client: 'warning',
  revisions: 'danger',
  approved: 'success',
  delivered: 'brand',
} as const satisfies Record<WorkflowStatus, NonNullable<BadgeProps['tone']>>;

type StatusBadgeProps = Omit<BadgeProps, 'tone'> & { status: WorkflowStatus };

/** A workflow status with its brand color and a status dot; the label comes from the caller. */
function StatusBadge({ status, children, ...props }: StatusBadgeProps) {
  return (
    <Badge tone={workflowStatusTone[status]} data-status={status} {...props}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </Badge>
  );
}

export { Badge, type BadgeProps, badgeVariants, StatusBadge, workflowStatusTone };
