import {
  Button,
  cn,
  Field,
  FieldDescription,
  FieldLabel,
  Progress,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@vertex-hub/ui';
import { PaperclipIcon, XIcon } from 'lucide-react';
import { useId, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errors';
import { formatFileSize } from '../../lib/format';
import { UploadNetworkError, uploadFile } from './files.queries';

/** A proof file being uploaded, or uploaded (`uploadId`), or refused (`error`). */
export interface Proof {
  file: File;
  sent: number;
  uploadId: string | null;
  error: string | null;
  controller: AbortController | null;
}

/**
 * One proof file, uploaded as soon as it is picked; the form sends its `uploadId` (a quote's
 * acceptance, F04 A1; a payment, F13 rule 20).
 */
export function ProofField({
  proof,
  onProof,
  label,
  hint,
}: {
  proof: Proof | null;
  onProof: (proof: Proof | null) => void;
  label: string;
  hint: string;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const progressId = useId();
  // Answers of an upload replaced or removed meanwhile are dropped.
  const current = useRef<Proof | null>(proof);
  current.current = proof;

  async function pick(file: File | undefined) {
    if (!file) return;
    proof?.controller?.abort();
    const controller = new AbortController();
    let entry: Proof = { file, sent: 0, uploadId: null, error: null, controller };
    const update = (change: Partial<Proof>) => {
      if (current.current?.controller !== controller) return;
      entry = { ...entry, ...change };
      onProof(entry);
    };
    onProof(entry);
    current.current = entry;
    try {
      const upload = await uploadFile(file, {
        signal: controller.signal,
        onProgress: (sent) => update({ sent }),
      });
      update({ uploadId: upload.uploadId, sent: 1 });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      update({
        error:
          error instanceof UploadNetworkError ? t('files.upload.network') : errorMessage(t, error),
      });
    }
  }

  // The remove button leaves with the file: the focus goes to "choose" that replaces it.
  const choose = useRef<HTMLButtonElement>(null);
  function remove() {
    proof?.controller?.abort();
    flushSync(() => onProof(null));
    choose.current?.focus();
  }

  return (
    <Field>
      <FieldLabel id={labelId} render={<span />}>
        {label}
      </FieldLabel>
      {proof ? (
        <div
          className={cn(
            'flex flex-col gap-2 rounded-md border px-3 py-2',
            proof.error ? 'border-destructive' : 'border-border',
          )}
        >
          <div className="flex items-center gap-2">
            <PaperclipIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span
              id={progressId}
              className="min-w-0 flex-1 truncate text-sm font-medium"
              dir="auto"
            >
              {proof.file.name}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatFileSize(proof.file.size)}
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('files.proof.remove', { name: proof.file.name })}
                    onClick={remove}
                  />
                }
              >
                <XIcon />
              </TooltipTrigger>
              <TooltipContent>{t('files.proof.remove', { name: proof.file.name })}</TooltipContent>
            </Tooltip>
          </div>
          {!proof.error && !proof.uploadId && (
            <Progress aria-labelledby={progressId} value={Math.round(proof.sent * 100)} />
          )}
          {proof.error && (
            <p role="alert" className="text-sm text-destructive-text">
              {proof.error}
            </p>
          )}
        </div>
      ) : (
        <div>
          <Button
            ref={choose}
            type="button"
            variant="outline"
            size="sm"
            aria-describedby={labelId}
            onClick={() => input.current?.click()}
          >
            <PaperclipIcon />
            {t('files.proof.choose')}
          </Button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          void pick(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <FieldDescription>{hint}</FieldDescription>
    </Field>
  );
}
