import type { ReactNode, Ref } from 'react';

/** The top of a profile tab: what it holds, and its main action at the inline end. */
export function TabHeader({
  title,
  description,
  action,
  headingRef,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** Makes the heading focusable from script, for a view that replaces the tab's content. */
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="text-lg font-bold">
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
