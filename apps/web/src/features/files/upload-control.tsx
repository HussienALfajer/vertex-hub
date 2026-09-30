import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  defaultFileItemName,
  FILE_MAX_BYTES,
  type FileSource,
  fileLinkSourceSchema,
  isBlockedFile,
} from '@vertex-hub/contracts';
import {
  Button,
  cn,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Progress,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@vertex-hub/ui';
import { CircleAlertIcon, RotateCwIcon, UploadIcon, XIcon } from 'lucide-react';
import { type DragEvent, useEffect, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { ApiError } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';
import { formatFileSize } from '../../lib/format';
import { FileTypeIcon } from './file-parts';
import { UploadNetworkError, uploadFile } from './files.queries';

/**
 * Attaches the uploaded file or the link (step 2). `name` is set when the user retried with
 * another name after `FILE_NAME_TAKEN` (edge case 3).
 */
export type AttachFile = (source: FileSource, name?: string) => Promise<unknown>;

interface UploadControlProps {
  onAttach: AttachFile;
  /** Called once everything the user added is attached, so the dialog can close. */
  onDone: () => void;
  /** Several files at once; one for a new version. */
  multiple?: boolean;
  /** The "Link" tab: deliverables, brand files and documents, never references (rule 2). */
  allowLink?: boolean;
}

/**
 * The upload control (screen 1): pick or drop files, each uploads with its progress and a cancel
 * button, and is attached as soon as its upload finishes. A failed file stays in the list with its
 * error until it is retried or discarded.
 */
export function UploadControl({ onAttach, onDone, multiple, allowLink }: UploadControlProps) {
  const { t } = useTranslation();
  const files = <FileQueue onAttach={onAttach} onDone={onDone} multiple={multiple} />;
  if (!allowLink) return files;
  return (
    <Tabs defaultValue="file" className="gap-4">
      <TabsList>
        <TabsTrigger value="file">{t('files.upload.fileTab')}</TabsTrigger>
        <TabsTrigger value="link">{t('files.upload.linkTab')}</TabsTrigger>
      </TabsList>
      <TabsContent value="file">{files}</TabsContent>
      <TabsContent value="link">
        <LinkForm onAttach={onAttach} onDone={onDone} />
      </TabsContent>
    </Tabs>
  );
}

type Entry = {
  key: string;
  file: File;
  /** The share sent, 0 to 1. */
  sent: number;
  /** Set once the upload succeeded, so a failed attach retries without uploading again. */
  uploadId: string | null;
  state: 'uploading' | 'attaching' | 'failed';
  error: string | null;
  /** The upload was refused for good (too large, blocked, empty): only discard is left. */
  final: boolean;
  /** Attaching failed on the name (edge case 3): the retry takes a new one. */
  nameTaken: boolean;
  controller: AbortController | null;
};

/** Refused before sending anything: the API would refuse the same (rule 1). */
const FINAL_CODES = ['FILE_EMPTY', 'FILE_TOO_LARGE', 'FILE_TYPE_BLOCKED'];

function FileQueue({
  onAttach,
  onDone,
  multiple,
}: Pick<UploadControlProps, 'onAttach' | 'onDone' | 'multiple'>) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [dragging, setDragging] = useState(false);
  const attached = useRef(0);
  // Uploads finish later than they start: attach with the dialog's values of that moment (a note).
  const latestAttach = useRef(onAttach);
  latestAttach.current = onAttach;
  const nextKey = useRef(0);

  // Everything added is attached: tell the dialog once.
  useEffect(() => {
    if (entries.length === 0 && attached.current > 0) {
      attached.current = 0;
      onDone();
    }
  }, [entries, onDone]);

  // Leaving the dialog cancels uploads still running.
  const running = useRef(entries);
  running.current = entries;
  useEffect(
    () => () => {
      for (const entry of running.current) entry.controller?.abort();
    },
    [],
  );

  const update = (key: string, change: Partial<Entry>) =>
    setEntries((all) => all.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)));

  const drop = (key: string) => setEntries((all) => all.filter((entry) => entry.key !== key));

  const fail = (key: string, error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') {
      drop(key);
      return;
    }
    const code = error instanceof ApiError ? error.knownCode : undefined;
    update(key, {
      state: 'failed',
      controller: null,
      error:
        error instanceof UploadNetworkError ? t('files.upload.network') : errorMessage(t, error),
      final: code !== undefined && FINAL_CODES.includes(code),
      nameTaken: code === 'FILE_NAME_TAKEN',
      // The upload is gone after the purge: the retry uploads again.
      ...(code === 'UPLOAD_NOT_FOUND' && { uploadId: null }),
    });
  };

  async function attach(key: string, uploadId: string, name?: string) {
    update(key, { state: 'attaching', error: null, nameTaken: false, uploadId });
    try {
      await latestAttach.current({ uploadId }, name);
      attached.current += 1;
      drop(key);
    } catch (error) {
      fail(key, error);
    }
  }

  async function send(entry: Entry) {
    const controller = new AbortController();
    update(entry.key, { state: 'uploading', error: null, sent: 0, controller });
    try {
      const upload = await uploadFile(entry.file, {
        signal: controller.signal,
        onProgress: (sent) => update(entry.key, { sent }),
      });
      await attach(entry.key, upload.uploadId);
    } catch (error) {
      fail(entry.key, error);
    }
  }

  function add(list: FileList | null) {
    const picked = Array.from(list ?? []).slice(0, multiple ? undefined : 1);
    const added = picked.map((file): Entry => {
      const refusal =
        file.size === 0
          ? 'FILE_EMPTY'
          : file.size > FILE_MAX_BYTES
            ? 'FILE_TOO_LARGE'
            : isBlockedFile(file.name, null)
              ? 'FILE_TYPE_BLOCKED'
              : null;
      nextKey.current += 1;
      return {
        key: String(nextKey.current),
        file,
        sent: 0,
        uploadId: null,
        state: refusal ? 'failed' : 'uploading',
        error: refusal ? t(`errors.${refusal}`) : null,
        final: refusal !== null,
        nameTaken: false,
        controller: null,
      };
    });
    setEntries((all) => [...all, ...added]);
    for (const entry of added) if (entry.state === 'uploading') void send(entry);
  }

  function retry(entry: Entry, name?: string) {
    if (entry.uploadId) void attach(entry.key, entry.uploadId, name);
    else void send(entry);
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    add(event.dataTransfer.files);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dropping is a shortcut; the button picks files */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center transition-colors',
          dragging && 'border-primary bg-muted',
        )}
      >
        <UploadIcon aria-hidden="true" className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t(multiple ? 'files.upload.dropMany' : 'files.upload.dropOne')}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
          {t(multiple ? 'files.upload.chooseMany' : 'files.upload.chooseOne')}
        </Button>
        <input
          ref={input}
          type="file"
          multiple={multiple}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            add(event.target.files);
            event.target.value = '';
          }}
        />
        <p className="text-xs text-muted-foreground">{t('files.upload.limits')}</p>
      </div>
      {entries.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={t('files.upload.queue')}>
          {entries.map((entry) => (
            <QueueRow
              key={entry.key}
              entry={entry}
              onCancel={() => entry.controller?.abort()}
              onDiscard={() => drop(entry.key)}
              onRetry={(name) => retry(entry, name)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function QueueRow({
  entry,
  onCancel,
  onDiscard,
  onRetry,
}: {
  entry: Entry;
  onCancel: () => void;
  onDiscard: () => void;
  onRetry: (name?: string) => void;
}) {
  const { t } = useTranslation();
  const nameId = useId();
  const progressId = useId();
  const [name, setName] = useState(() => defaultFileItemName({ originalName: entry.file.name }));
  const failed = entry.state === 'failed';
  const label = entry.file.name;
  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-md border px-3 py-2',
        failed ? 'border-destructive' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2">
        <FileTypeIcon type="other" className="size-4 shrink-0 text-muted-foreground" />
        <span id={progressId} className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">
          {label}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatFileSize(entry.file.size)}
        </span>
        {failed ? (
          <>
            {!entry.final && !entry.nameTaken && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('files.upload.retry', { name: label })}
                onClick={() => onRetry()}
              >
                <RotateCwIcon />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('files.upload.discard', { name: label })}
              onClick={onDiscard}
            >
              <XIcon />
            </Button>
          </>
        ) : (
          entry.state === 'uploading' && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('files.upload.cancel', { name: label })}
              onClick={onCancel}
            >
              <XIcon />
            </Button>
          )
        )}
      </div>
      {!failed && (
        <Progress
          aria-labelledby={progressId}
          // Everything sent: the server stores and attaches it, for an unknown while.
          value={
            entry.state === 'attaching' || entry.sent >= 1 ? null : Math.round(entry.sent * 100)
          }
        />
      )}
      {failed && entry.error && (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive-text">
          <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
          {entry.error}
        </p>
      )}
      {failed && entry.nameTaken && (
        <div className="flex items-end gap-2">
          <Field className="flex-1">
            <FieldLabel htmlFor={nameId}>{t('files.upload.newName')}</FieldLabel>
            <Input
              id={nameId}
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Button
            type="button"
            variant="outline"
            disabled={!name.trim()}
            onClick={() => onRetry(name.trim())}
          >
            {t('files.upload.retryWithName')}
          </Button>
        </div>
      )}
    </li>
  );
}

type LinkValues = { url: string; label?: string | null };

function LinkForm({ onAttach, onDone }: Pick<UploadControlProps, 'onAttach' | 'onDone'>) {
  const { t } = useTranslation();
  const ids = { url: useId(), label: useId() };
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<LinkValues>({
    resolver: standardSchemaResolver(fileLinkSourceSchema),
    defaultValues: { url: '', label: '' },
  });
  const urlError = form.formState.errors.url;
  // The control may sit inside a form, and forms do not nest: the link is sent from its button.
  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await onAttach({ url: values.url, label: values.label || undefined });
      onDone();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });
  return (
    <div className="grid gap-4">
      <Field invalid={!!urlError}>
        <FieldLabel htmlFor={ids.url}>{t('files.upload.url')}</FieldLabel>
        <Input id={ids.url} type="url" dir="ltr" placeholder="https://" {...form.register('url')} />
        <FieldError match={!!urlError}>{t('files.upload.errors.url')}</FieldError>
      </Field>
      <Field>
        <FieldLabel htmlFor={ids.label}>{t('files.upload.label')}</FieldLabel>
        <Input
          id={ids.label}
          placeholder={t('files.upload.labelPlaceholder')}
          {...form.register('label')}
        />
      </Field>
      {failure && <FormAlert>{failure}</FormAlert>}
      <div>
        <Button type="button" onClick={submit} disabled={form.formState.isSubmitting}>
          {t('files.upload.addLink')}
        </Button>
      </div>
    </div>
  );
}
