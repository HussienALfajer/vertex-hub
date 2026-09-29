import type { TemplateKind } from '@vertex-hub/contracts';
import { Badge } from '@vertex-hub/ui';
import { CalendarSyncIcon, FolderKanbanIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Project templates in brand green, monthly ones in info blue. */
export function TemplateKindBadge({ kind }: { kind: TemplateKind }) {
  const { t } = useTranslation();
  return (
    <Badge tone={kind === 'project' ? 'brand' : 'info'}>
      {kind === 'project' ? (
        <FolderKanbanIcon aria-hidden="true" />
      ) : (
        <CalendarSyncIcon aria-hidden="true" />
      )}
      {t(`templates.kinds.${kind}`)}
    </Badge>
  );
}
