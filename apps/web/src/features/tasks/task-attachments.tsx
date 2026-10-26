import type { TaskAttachment } from '@vertex-hub/contracts';
import { Button, cn, IconButton, Progress, toast } from '@vertex-hub/ui';
import { DownloadIcon, FileIcon, FileVideoIcon, PaperclipIcon, XIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errors';
import { formatFileSize, formatNumber } from '../../lib/format';
import { useFileViewer, type ViewerItem } from '../files/file-viewer';
import {
  fileContentUrl,
  fileDownloadUrl,
  filePreviewUrl,
  fileThumbnailUrl,
  uploadFile,
} from '../files/files.queries';
import { namedFiles } from '../files/held-uploads';

/*
 * F06B rule B2: the attachments of a comment, a question or a reply. Files are uploaded as soon as
 * they are dropped, pasted or chosen (F10 rule 1) and held until the message is sent.
 */

export interface HeldUpload {
  key: string;
  name: string;
  sizeBytes: number;
  /** 0 to 1 while it uploads. */
  progress: number;
  uploadId: string | null;
  failed: string | null;
}

/** The uploads of one message: add, remove, and the ids to send once all are done. */
export function useHeldUploads(max: number) {
  const { t } = useTranslation();
  const [uploads, setUploads] = useState<HeldUpload[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  // Leaving the page cancels uploads still running; finished ones are purged by F10.
  useEffect(() => {
    const running = controllers.current;
    return () => {
      for (const controller of running.values()) controller.abort();
    };
  }, []);

  const patch = (key: string, change: Partial<HeldUpload>) =>
    setUploads((current) =>
      current.map((upload) => (upload.key === key ? { ...upload, ...change } : upload)),
    );

  function add(files: readonly File[], pasted = false) {
    if (files.length === 0) {
      // Edge case 18: a copied file reference the browser cannot read.
      toast.add({ title: t('tasks.attachments.nothingToPaste'), type: 'error' });
      return;
    }
    const room = max - uploads.length;
    if (files.length > room) {
      toast.add({ title: t('tasks.attachments.limit', { max }), type: 'error' });
    }
    for (const file of namedFiles(files.slice(0, Math.max(0, room)), new Date(), pasted)) {
      const key = crypto.randomUUID();
      const controller = new AbortController();
      controllers.current.set(key, controller);
      setUploads((current) => [
        ...current,
        {
          key,
          name: file.name,
          sizeBytes: file.size,
          progress: 0,
          uploadId: null,
          failed: null,
        },
      ]);
      uploadFile(file, {
        signal: controller.signal,
        onProgress: (progress) => patch(key, { progress }),
      })
        .then((upload) => patch(key, { uploadId: upload.uploadId, progress: 1 }))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          patch(key, { failed: errorMessage(t, error) });
        })
        .finally(() => controllers.current.delete(key));
    }
  }

  function remove(key: string) {
    controllers.current.get(key)?.abort();
    setUploads((current) => current.filter((upload) => upload.key !== key));
  }

  return {
    uploads,
    add,
    remove,
    clear: () => setUploads([]),
    /** Every upload is done (failed ones are removed by the user first). */
    ready: uploads.every((upload) => upload.uploadId !== null),
    files: uploads.flatMap((upload) => (upload.uploadId ? [{ uploadId: upload.uploadId }] : [])),
  };
}

export type HeldUploads = ReturnType<typeof useHeldUploads>;

/** The attach button and the list of held uploads under a message editor. */
export function HeldUploadList({ held, max }: { held: HeldUploads; max: number }) {
  const { t } = useTranslation();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      {held.uploads.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {held.uploads.map((upload) => (
            <li
              key={upload.key}
              className={cn(
                'flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm',
                upload.failed && 'border-destructive-text',
              )}
            >
              <PaperclipIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate" dir="auto">
                  {upload.name}
                </span>
                {upload.failed ? (
                  <span role="alert" className="text-xs text-destructive-text">
                    {upload.failed}
                  </span>
                ) : upload.uploadId === null ? (
                  <Progress
                    value={upload.progress * 100}
                    aria-label={t('tasks.attachments.uploading', { name: upload.name })}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {formatFileSize(upload.sizeBytes)}
                  </span>
                )}
              </span>
              <IconButton
                label={t('common.remove', { label: upload.name })}
                onClick={() => held.remove(upload.key)}
              >
                <XIcon />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <div>
        <input
          ref={input}
          id={inputId}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            held.add([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={held.uploads.length >= max}
          onClick={() => input.current?.click()}
        >
          <PaperclipIcon />
          {t('tasks.attachments.add')}
        </Button>
      </div>
    </div>
  );
}

const isImage = (attachment: TaskAttachment) => attachment.mimeType.startsWith('image/');
const isVideo = (attachment: TaskAttachment) => attachment.mimeType.startsWith('video/');

/** The viewer's items of a message's images and videos; `details` says who and what (rule C4). */
export function attachmentViewerItems(
  attachments: readonly TaskAttachment[],
  details: string,
): ViewerItem[] {
  return attachments.flatMap((attachment): ViewerItem[] =>
    isImage(attachment) || isVideo(attachment)
      ? [
          {
            key: attachment.id,
            kind: isImage(attachment) ? 'image' : 'video',
            src:
              isImage(attachment) && attachment.previewReady
                ? filePreviewUrl(attachment.versionId)
                : fileContentUrl(attachment.versionId),
            name: attachment.name,
            details,
            downloadHref: fileDownloadUrl(attachment.versionId),
          },
        ]
      : [],
  );
}

/** A message's attachments: images and videos open in the viewer, other files download. */
export function AttachmentList({
  attachments,
  author,
}: {
  attachments: readonly TaskAttachment[];
  /** Who attached them: the message's author. */
  author: string;
}) {
  const { t } = useTranslation();
  const { open, viewer } = useFileViewer();
  if (attachments.length === 0) return null;
  // Attachments are single uploads (rule B2): always their first version.
  const items = attachmentViewerItems(
    attachments,
    [
      t('tasks.files.viewerVersion', { n: formatNumber(1) }),
      t('tasks.files.roles.attachment'),
      author,
    ].join(' · '),
  );
  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {attachments.map((attachment) => {
          const at = items.findIndex((item) => item.key === attachment.id);
          return (
            <li key={attachment.id}>
              {at >= 0 ? (
                <button
                  type="button"
                  aria-label={t('files.previewNamed', { name: attachment.name })}
                  className="flex items-center gap-2 rounded-md border border-border bg-surface p-1 pe-2 text-sm hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => open(items, at)}
                >
                  <span className="flex size-10 items-center justify-center overflow-hidden rounded-sm bg-muted text-muted-foreground">
                    {isImage(attachment) && attachment.previewReady ? (
                      <img
                        src={fileThumbnailUrl(attachment.versionId)}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <FileVideoIcon aria-hidden="true" className="size-4" />
                    )}
                  </span>
                  <span className="max-w-40 truncate" dir="auto">
                    {attachment.name}
                  </span>
                </button>
              ) : (
                <a
                  href={fileDownloadUrl(attachment.versionId)}
                  className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-sm hover:bg-muted/50"
                >
                  <FileIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                  <span className="max-w-40 truncate" dir="auto">
                    {attachment.name}
                  </span>
                  <DownloadIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                  <span className="sr-only">{t('files.download')}</span>
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {viewer}
    </>
  );
}
