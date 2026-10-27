import { cn } from '@vertex-hub/ui';
import { formatNumber } from '../lib/format';

/**
 * The steps of a wizard (the task and post wizards): each can be opened at any time, the current
 * one marked, with an optional count beside its name.
 */
export function StepBar<S extends string>({
  steps,
  step,
  label,
  stepName,
  counts,
  onGoTo,
}: {
  steps: readonly S[];
  step: S;
  /** Names the step list for assistive technology. */
  label: string;
  stepName: (step: S) => string;
  counts?: number[];
  onGoTo: (step: S) => void;
}) {
  const current = steps.indexOf(step);
  return (
    <nav aria-label={label}>
      <ol className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1">
        {steps.map((item, index) => (
          <li key={item} className="min-w-fit flex-1">
            <button
              type="button"
              aria-current={item === step ? 'step' : undefined}
              onClick={() => onGoTo(item)}
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors duration-150 ease-out',
                item === step
                  ? 'bg-primary font-bold text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-5 items-center justify-center rounded-full border text-xs tabular-nums',
                  index < current ? 'border-current' : 'border-current/50',
                )}
              >
                {formatNumber(index + 1)}
              </span>
              {stepName(item)}
              {(counts?.[index] ?? 0) > 0 && (
                <span className="text-xs tabular-nums">({formatNumber(counts?.[index] ?? 0)})</span>
              )}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
