import { Link } from '@tanstack/react-router';
import type { InvoiceLine } from '@vertex-hub/contracts';
import { Badge } from '@vertex-hub/ui';
import { FlagIcon, RepeatIcon, SparklesIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type LineSource = NonNullable<InvoiceLine['source']>;

const icons = { milestone: FlagIcon, retainer_cycle: RepeatIcon, extra_work: SparklesIcon };

/** What a line bills, linking to the project or retainer it lives on (rule 11). */
export function SourceChip({ source }: { source: LineSource }) {
  const { t } = useTranslation();
  const Icon = icons[source.type];
  const label = t(`invoices.sources.${source.type}`, { name: source.name });
  const chip = (
    <Badge tone="info">
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
  if (source.project) {
    return (
      <Link
        to="/projects/$projectId"
        params={{ projectId: source.project.id }}
        className="rounded-sm outline-offset-2 hover:underline"
      >
        {chip}
      </Link>
    );
  }
  if (source.retainer) {
    return (
      <Link
        to="/retainers/$retainerId"
        params={{ retainerId: source.retainer.id }}
        className="rounded-sm outline-offset-2 hover:underline"
      >
        {chip}
      </Link>
    );
  }
  return chip;
}
