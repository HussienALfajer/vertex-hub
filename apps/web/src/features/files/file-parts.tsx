import type { FileType, FileVersion } from '@vertex-hub/contracts';
import { Badge, cn } from '@vertex-hub/ui';
import {
  CircleCheckIcon,
  FileIcon,
  FileTextIcon,
  FileVideoIcon,
  ImageIcon,
  LinkIcon,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatFileSize, formatLinkHost } from '../../lib/format';
import { fileThumbnailUrl } from './files.queries';

const TYPE_ICONS: Record<FileType, LucideIcon> = {
  image: ImageIcon,
  video: FileVideoIcon,
  pdf: FileTextIcon,
  link: LinkIcon,
  other: FileIcon,
};

/**
 * A version's rendered thumbnail once the preview job is done (rule 18), otherwise its type icon
 * (pending, failed, not an image, a link).
 */
export function FileThumbnail({
  version,
  className,
}: {
  version: Pick<FileVersion, 'id' | 'type' | 'previewStatus'>;
  className?: string;
}) {
  const Icon = TYPE_ICONS[version.type];
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground',
        className,
      )}
    >
      {version.previewStatus === 'ready' ? (
        <img
          src={fileThumbnailUrl(version.id)}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        <Icon aria-hidden="true" className="size-1/3 min-w-5" />
      )}
    </span>
  );
}

export function FileTypeIcon({ type, className }: { type: FileType; className?: string }) {
  const Icon = TYPE_ICONS[type];
  return <Icon aria-hidden="true" className={className} />;
}

/** "v3": Latin, as the team writes versions. */
export function VersionBadge({ number }: { number: number }) {
  const { t } = useTranslation();
  return (
    <Badge tone="outline" dir="ltr" className="tabular-nums">
      {t('files.versionNumber', { number })}
    </Badge>
  );
}

/** The final version; one the client approved says so (F09 rule 13). */
export function FinalBadge({ source }: { source?: FileVersion['finalSource'] }) {
  const { t } = useTranslation();
  return (
    <Badge tone="success">
      <CircleCheckIcon aria-hidden="true" />
      {source === 'client' ? t('files.finalByClient') : t('files.final')}
    </Badge>
  );
}

export function RemovedBadge() {
  const { t } = useTranslation();
  return <Badge tone="neutral">{t('files.removed')}</Badge>;
}

/** The size of an upload, or the host of a link. */
export function versionSize(version: Pick<FileVersion, 'kind' | 'sizeBytes' | 'url'>): string {
  if (version.kind === 'link') return formatLinkHost(version.url ?? '');
  return version.sizeBytes === null ? '' : formatFileSize(version.sizeBytes);
}

/** The first version not removed: versions come newest first. */
export const latestVersion = <V extends Pick<FileVersion, 'archivedAt'>>(versions: V[]) =>
  versions.find((version) => version.archivedAt === null);
