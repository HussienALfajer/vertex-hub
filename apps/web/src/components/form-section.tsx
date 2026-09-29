import type { ReactNode } from 'react';

/** A titled block of the form: the explanation beside the fields on wide screens. */
export function FormSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 rounded-lg border border-border bg-surface p-6 xl:grid-cols-[12rem_1fr] xl:gap-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
    </section>
  );
}
