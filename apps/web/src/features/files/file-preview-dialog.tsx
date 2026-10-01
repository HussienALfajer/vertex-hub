import { type FileVersion, isInlineMimeType } from '@vertex-hub/contracts';
import { Button, Dialog, DialogContent, DialogTitle } from '@vertex-hub/ui';
import { ArrowLeftIcon, ArrowRightIcon, DownloadIcon, ExternalLinkIcon } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';
import { FileTypeIcon, FinalBadge, VersionBadge, versionSize } from './file-parts';
import { fileContentUrl, fileDownloadUrl, filePreviewUrl } from './files.queries';

/** One file the dialog shows: a version and the name of its item. */
export interface PreviewEntry {
  name: string;
  version: FileVersion;
}

/**
 * The preview dialog (screen 3): the rendered preview of an image, the browser's viewer for PDFs
 * and videos, the address of a link, and a download for everything else. Previous and next move
 * through `entries` (the versions of an item, or a group of references).
 */
export function FilePreviewDialog({
  entries,
  index,
  onIndexChange,
  onClose,
}: {
  entries: PreviewEntry[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  // Focus starts on the download or open button, never inside a PDF frame that would keep the
  // arrow keys.
  const initialFocus = useRef<HTMLAnchorElement>(null);
  const entry = entries[index];
  if (!entry) return null;
  const { version } = entry;
  const hasPrevious = index > 0;
  const hasNext = index < entries.length - 1;

  // Arrows follow the reading direction: in Arabic the next file is to the left.
  const onKeyDown = (event: KeyboardEvent) => {
    const forward = i18n.dir() === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const back = i18n.dir() === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === forward && hasNext) onIndexChange(index + 1);
    else if (event.key === back && hasPrevious) onIndexChange(index - 1);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        closeLabel={t('common.close')}
        initialFocus={initialFocus}
        onKeyDown={onKeyDown}
        className="flex h-[calc(100dvh-2rem)] max-w-6xl flex-col gap-4 p-4 sm:p-6"
      >
        <div className="flex flex-wrap items-center gap-2 pe-10">
          <DialogTitle className="min-w-0 truncate text-lg" dir="auto">
            {entry.name}
          </DialogTitle>
          <VersionBadge number={version.number} />
          {version.isFinal && <FinalBadge source={version.finalSource} />}
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-muted">
          <PreviewBody entry={entry} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {version.kind === 'upload' ? (
            <Button
              variant="outline"
              size="sm"
              render={<a ref={initialFocus} href={fileDownloadUrl(version.id)} />}
            >
              <DownloadIcon />
              {t('files.download')}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              render={
                <a
                  ref={initialFocus}
                  href={version.url ?? ''}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <ExternalLinkIcon />
              {t('files.openLink')}
            </Button>
          )}
          {entries.length > 1 && (
            <div className="ms-auto flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('files.preview.previous')}
                disabled={!hasPrevious}
                onClick={() => onIndexChange(index - 1)}
              >
                <ArrowRightIcon className="ltr:-scale-x-100" />
              </Button>
              <span className="text-sm text-muted-foreground tabular-nums">
                {t('files.preview.position', {
                  current: formatNumber(index + 1),
                  total: formatNumber(entries.length),
                })}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('files.preview.next')}
                disabled={!hasNext}
                onClick={() => onIndexChange(index + 1)}
              >
                <ArrowLeftIcon className="ltr:-scale-x-100" />
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({ entry: { name, version } }: { entry: PreviewEntry }) {
  const content = fileContentUrl(version.id);
  const inline = isInlineMimeType(version.mimeType);

  if (version.kind === 'link') {
    return (
      <Fallback version={version}>
        <p dir="ltr" className="max-w-full text-sm break-all text-muted-foreground">
          {version.url}
        </p>
      </Fallback>
    );
  }
  if (version.type === 'image' && (version.previewStatus === 'ready' || inline)) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 p-3">
        <img
          src={version.previewStatus === 'ready' ? filePreviewUrl(version.id) : content}
          alt={name}
          className="min-h-0 max-w-full flex-1 object-contain"
        />
        <OpenOriginal href={content} />
      </div>
    );
  }
  if (version.type === 'pdf') {
    // Some browsers (phones) show no PDF inside a page: the original opens in their own viewer.
    return (
      <div className="flex size-full flex-col items-center gap-3 p-3">
        <iframe src={content} title={name} className="min-h-0 w-full flex-1 border-0 bg-surface" />
        <OpenOriginal href={content} />
      </div>
    );
  }
  if (version.type === 'video' && inline) {
    // biome-ignore lint/a11y/useMediaCaption: team work files have no captions to offer
    return <video src={content} controls preload="metadata" className="max-h-full max-w-full" />;
  }
  return <Fallback version={version} />;
}

function OpenOriginal({ href }: { href: string }) {
  const { t } = useTranslation();
  return (
    <Button
      variant="outline"
      size="sm"
      render={<a href={href} target="_blank" rel="noopener noreferrer" />}
    >
      <ExternalLinkIcon />
      {t('files.preview.openOriginal')}
    </Button>
  );
}

/** A link, or a type the browser cannot show: its icon, type and size. */
function Fallback({ version, children }: { version: FileVersion; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex max-w-md flex-col items-center gap-3 p-6 text-center">
      <FileTypeIcon type={version.type} className="size-12 text-muted-foreground" />
      <p className="font-medium">{t(`files.types.${version.type}`)}</p>
      <p className="text-sm text-muted-foreground" dir="auto">
        {[version.originalName ?? version.linkLabel, versionSize(version)]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {version.previewStatus === 'pending' && (
        <p className="text-sm text-muted-foreground">{t('files.preview.pending')}</p>
      )}
      {version.previewStatus === 'failed' && (
        <p className="text-sm text-muted-foreground">{t('files.preview.failed')}</p>
      )}
      {children}
    </div>
  );
}
