import { useQuery } from '@tanstack/react-query';
import {
  CONTENT_PLANNING_LIMITS,
  type ContentSnippet,
  createContentSnippetSchema,
  SNIPPET_KINDS,
  type SnippetKind,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  Skeleton,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import { ArchiveIcon, HashIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { FormDialog } from '../quotes/quote-dialogs';
import {
  contentSnippetsQuery,
  useArchiveSnippet,
  useCreateSnippet,
  useUpdateSnippet,
} from './content.queries';

/*
 * Saved hashtag sets and caption snippets (spec F08B rule A10): a client's on its Content tab,
 * the agency's on the content settings. Archived ones leave the pickers.
 */

/** The snippets of one owner (a client, or the agency with `clientId` null), by kind. */
export function SnippetsManager({
  clientId,
  canEdit,
}: {
  clientId: string | null;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<SnippetKind>('hashtags');
  const [editing, setEditing] = useState<ContentSnippet | 'new' | null>(null);
  const [archiving, setArchiving] = useState<ContentSnippet | null>(null);
  const archive = useArchiveSnippet();
  const snippets = useQuery(contentSnippetsQuery({ ...(clientId && { clientId }), kind }));
  // The client's list carries the agency's too: only the owner's are edited here.
  const items = (snippets.data?.items ?? []).filter(
    (snippet) => (snippet.client?.id ?? null) === clientId,
  );

  return (
    <div className="flex flex-col gap-3" data-snippets>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          aria-label={t('content.snippets.kind')}
          value={[kind]}
          onValueChange={(next: SnippetKind[]) => next[0] && setKind(next[0])}
        >
          {SNIPPET_KINDS.map((item) => (
            <ToggleGroupItem key={item} value={item}>
              {t(`content.snippets.kinds.${item}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {canEdit && items.length < CONTENT_PLANNING_LIMITS.snippets && (
          <Button variant="outline" size="sm" className="ms-auto" onClick={() => setEditing('new')}>
            <PlusIcon />
            {t('content.snippets.add')}
          </Button>
        )}
      </div>
      {snippets.isPending ? (
        <Skeleton className="h-24" />
      ) : snippets.isError ? (
        <LoadError message={t('content.snippets.loadError')} onRetry={() => snippets.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<HashIcon />}
          title={t('content.snippets.emptyTitle')}
          description={canEdit ? t('content.snippets.emptyHint') : undefined}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {items.map((snippet) => (
            <li key={snippet.id} className="flex items-start gap-3 px-3 py-2.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-medium">{snippet.name}</span>
                <span className="line-clamp-2 text-sm whitespace-pre-line text-muted-foreground">
                  {snippet.body}
                </span>
              </div>
              {canEdit && snippet.canEdit && (
                <span className="flex items-center gap-1">
                  <IconButton
                    label={t('content.snippets.edit', { name: snippet.name })}
                    onClick={() => setEditing(snippet)}
                  >
                    <PencilIcon />
                  </IconButton>
                  <IconButton
                    label={t('content.snippets.archive', { name: snippet.name })}
                    onClick={() => setArchiving(snippet)}
                  >
                    <ArchiveIcon />
                  </IconButton>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <Badge tone="outline" className="tabular-nums">
          {t('content.snippets.count', {
            n: formatNumber(items.length),
            max: formatNumber(CONTENT_PLANNING_LIMITS.snippets),
          })}
        </Badge>
      )}
      <SnippetDialog
        clientId={clientId}
        kind={kind}
        snippet={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={t('content.snippets.archiveTitle', { name: archiving?.name ?? '' })}
        body={t('content.snippets.archiveBody')}
        action={t('content.snippets.archiveAction')}
        pending={archive.isPending}
        onConfirm={async () => {
          if (!archiving) return;
          await archive.mutateAsync(archiving.id);
          toast.add({ title: t('content.snippets.archived'), type: 'success' });
        }}
      />
    </div>
  );
}

interface SnippetValues {
  name: string;
  body: string;
}

function SnippetDialog({
  clientId,
  kind,
  snippet,
  open,
  onClose,
}: {
  clientId: string | null;
  kind: SnippetKind;
  snippet: ContentSnippet | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const nameId = useId();
  const bodyId = useId();
  const create = useCreateSnippet();
  const update = useUpdateSnippet();
  const [failure, setFailure] = useState<string | null>(null);
  const shownKind = snippet?.kind ?? kind;
  const defaults: SnippetValues = { name: snippet?.name ?? '', body: snippet?.body ?? '' };
  const form = useForm<SnippetValues>({ values: defaults });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const checked = createContentSnippetSchema.safeParse({ clientId, kind: shownKind, ...values });
    if (!checked.success) {
      for (const issue of checked.error.issues) {
        const field = issue.path[0];
        if (field === 'name' || field === 'body') form.setError(field, { type: 'schema' });
      }
      return;
    }
    try {
      if (snippet) {
        await update.mutateAsync({
          id: snippet.id,
          name: checked.data.name,
          body: checked.data.body,
        });
      } else {
        await create.mutateAsync(checked.data);
      }
      toast.add({ title: t('content.snippets.saved'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onClosed={() => {
        setFailure(null);
        form.reset(defaults);
      }}
      submitting={form.formState.isSubmitting}
      title={snippet ? t('content.snippets.editTitle') : t('content.snippets.addTitle')}
      description={t(`content.snippets.hints.${shownKind}`)}
      action={t('common.save')}
      failure={failure}
      onSubmit={submit}
    >
      <Field invalid={!!errors.name}>
        <FieldLabel htmlFor={nameId}>{t('content.snippets.name')}</FieldLabel>
        <Input
          id={nameId}
          maxLength={CONTENT_PLANNING_LIMITS.snippetName}
          {...form.register('name')}
        />
        <FieldError match={!!errors.name}>{t('content.snippets.nameError')}</FieldError>
      </Field>
      <Field invalid={!!errors.body}>
        <FieldLabel htmlFor={bodyId}>{t('content.snippets.body')}</FieldLabel>
        <Textarea
          id={bodyId}
          rows={4}
          maxLength={CONTENT_PLANNING_LIMITS.snippetBody[shownKind]}
          {...form.register('body')}
        />
        <FieldError match={!!errors.body}>
          {t('content.snippets.bodyError', {
            n: formatNumber(CONTENT_PLANNING_LIMITS.snippetBody[shownKind]),
          })}
        </FieldError>
      </Field>
    </FormDialog>
  );
}

/** Screen 3: the client's snippets in a dialog, from its Content tab. */
export function SnippetsDialog({
  clientId,
  clientName,
  canEdit,
  open,
  onClose,
}: {
  clientId: string;
  clientName: string;
  canEdit: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('content.snippets.titleFor', { name: clientName })}</DialogTitle>
          <DialogDescription>{t('content.snippets.hint')}</DialogDescription>
        </DialogHeader>
        {open && <SnippetsManager clientId={clientId} canEdit={canEdit} />}
      </DialogContent>
    </Dialog>
  );
}
