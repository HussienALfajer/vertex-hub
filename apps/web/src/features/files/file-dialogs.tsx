import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  BRAND_FILE_KINDS,
  type BrandFileKind,
  FILE_NOTE_MAX,
  type FileItem,
  type FileRole,
  type FileSource,
  type UpdateFileItem,
  updateFileItemSchema,
} from '@vertex-hub/contracts';
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { type ComponentProps, type RefObject, useCallback, useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { errorMessage } from '../../lib/errors';
import type { FileItemActions, Removing } from './file-item-card';
import { FilePreviewDialog, type PreviewEntry } from './file-preview-dialog';
import {
  type FileOwnerRef,
  useAddFileVersion,
  useArchiveFileItem,
  useArchiveFileVersion,
  useCreateFileItem,
  useUpdateFileItem,
} from './files.queries';
import { UploadControl } from './upload-control';

/** "What changed", sent with every file added from the dialog. */
/** A version's note: what changed, or for a new file what it is (`first`). */
function NoteField({
  value,
  onChange,
  first,
}: {
  value: string;
  onChange: (value: string) => void;
  first?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {first ? t('files.firstNote') : t('files.note')}
        {first && (
          <span className="ms-1 font-normal text-muted-foreground">({t('common.optional')})</span>
        )}
      </FieldLabel>
      <Textarea
        id={id}
        rows={2}
        maxLength={FILE_NOTE_MAX}
        placeholder={first ? t('files.firstNotePlaceholder') : t('files.notePlaceholder')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/** The brand kit's kind of a brand file (the F02 kinds). */
function BrandKindField({
  value,
  onChange,
}: {
  value: BrandFileKind;
  onChange: (value: BrandFileKind) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const kinds = BRAND_FILE_KINDS.map((kind) => ({
    value: kind,
    label: t(`clients.brandKit.fileKinds.${kind}`),
  }));
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t('files.brandKind')}</FieldLabel>
      <Select
        items={kinds}
        value={value}
        onValueChange={(next) => next && onChange(next as BrandFileKind)}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {kinds.map((kind) => (
            <SelectItem key={kind.value} value={kind.value}>
              {kind.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/**
 * Adds new items of one role: one item per file, or one from a link. Closes once everything the
 * user added is attached. Brand files take a kind; documents may be flagged confidential by a
 * confidential reader (rule 15).
 */
export function AddFilesDialog({
  owner,
  fileRole,
  title,
  description,
  withNote,
  allowLink,
  withConfidential,
  onClose,
  finalFocus,
}: {
  owner: FileOwnerRef;
  fileRole: FileRole;
  title: string;
  description: string;
  withNote?: boolean;
  allowLink?: boolean;
  withConfidential?: boolean;
  onClose: () => void;
  /** Where the focus goes when it closes, when the button that opened it may be gone. */
  finalFocus?: ComponentProps<typeof DialogContent>['finalFocus'];
}) {
  const { t } = useTranslation();
  const confidentialId = useId();
  const create = useCreateFileItem(owner);
  const [note, setNote] = useState('');
  const [brandKind, setBrandKind] = useState<BrandFileKind>('logo');
  const [confidential, setConfidential] = useState(false);
  const onAttach = (source: FileSource, name?: string) =>
    create.mutateAsync({
      role: fileRole,
      source,
      name,
      note: note.trim() || undefined,
      ...(fileRole === 'brand' && { brandKind }),
      ...(fileRole === 'document' && { confidential }),
    });
  const onDone = useCallback(() => {
    toast.add({ title: t('files.added'), type: 'success' });
    onClose();
  }, [t, onClose]);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')} finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {fileRole === 'brand' && <BrandKindField value={brandKind} onChange={setBrandKind} />}
        {withNote && <NoteField value={note} onChange={setNote} first />}
        {withConfidential && (
          <label
            htmlFor={confidentialId}
            className="flex cursor-pointer items-start gap-3 text-sm font-medium"
          >
            <Checkbox
              id={confidentialId}
              checked={confidential}
              onCheckedChange={(value) => setConfidential(value)}
            />
            <span className="flex flex-col gap-0.5">
              {t('files.confidentialChoice')}
              <span className="font-normal text-muted-foreground">
                {t('files.confidentialHint')}
              </span>
            </span>
          </label>
        )}
        <UploadControl onAttach={onAttach} onDone={onDone} multiple allowLink={allowLink} />
      </DialogContent>
    </Dialog>
  );
}

/** Adds the next version of an item: one file or a link, with an optional note. */
export function NewVersionDialog({
  owner,
  item,
  allowLink,
  onClose,
}: {
  owner: FileOwnerRef;
  item: FileItem;
  allowLink?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const add = useAddFileVersion(owner);
  const [note, setNote] = useState('');
  const onAttach = (source: FileSource) =>
    add.mutateAsync({ itemId: item.id, source, note: note.trim() || undefined });
  const onDone = useCallback(() => {
    toast.add({ title: t('files.versionAdded'), type: 'success' });
    onClose();
  }, [t, onClose]);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('files.newVersionTitle', { name: item.name })}</DialogTitle>
          <DialogDescription>{t('files.newVersionBody')}</DialogDescription>
        </DialogHeader>
        <NoteField value={note} onChange={setNote} />
        <UploadControl onAttach={onAttach} onDone={onDone} allowLink={allowLink} />
      </DialogContent>
    </Dialog>
  );
}

export function RenameFileDialog({
  owner,
  item,
  onClose,
}: {
  owner: FileOwnerRef;
  item: FileItem;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const update = useUpdateFileItem(owner);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<UpdateFileItem>({
    resolver: standardSchemaResolver(updateFileItemSchema),
    defaultValues: { name: item.name },
  });
  const nameError = form.formState.errors.name;
  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await update.mutateAsync({ itemId: item.id, name: values.name });
      toast.add({ title: t('files.renamed'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('files.renameTitle')}</DialogTitle>
          </DialogHeader>
          <Field invalid={!!nameError}>
            <FieldLabel htmlFor={id}>{t('files.name')}</FieldLabel>
            <Input id={id} {...form.register('name')} />
            <FieldError match={!!nameError}>{t('files.errors.name')}</FieldError>
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Preview = { entries: PreviewEntry[]; index: number } | null;

/**
 * The dialogs behind a list of file items (new version, rename, remove, preview) and the
 * actions its cards call. `allowLink`: new versions may be links.
 */
export function useFileItemActions(
  owner: FileOwnerRef,
  {
    allowLink,
    afterItemRemoved,
  }: {
    allowLink: boolean;
    /** Takes the focus once a removed item leaves the list with the menu that removed it. */
    afterItemRemoved?: RefObject<HTMLElement | null>;
  },
) {
  const { t } = useTranslation();
  const [versioning, setVersioning] = useState<FileItem | null>(null);
  const [renaming, setRenaming] = useState<FileItem | null>(null);
  const [removing, setRemoving] = useState<Removing>(null);
  const [preview, setPreview] = useState<Preview>(null);
  const archiveItem = useArchiveFileItem(owner);
  const archiveVersion = useArchiveFileVersion(owner);
  const update = useUpdateFileItem(owner);

  const actions: FileItemActions = {
    owner,
    onPreview: (entries, index) => setPreview({ entries, index }),
    onNewVersion: setVersioning,
    onRename: setRenaming,
    onRemove: setRemoving,
    onSetConfidential: (item, confidential) =>
      update
        .mutateAsync({ itemId: item.id, confidential })
        .then(() =>
          toast.add({
            title: confidential ? t('files.madeConfidential') : t('files.madeNotConfidential'),
            type: 'success',
          }),
        )
        .catch((error) => toast.add({ title: errorMessage(t, error), type: 'error' })),
  };

  const dialogs = (
    <>
      {versioning && (
        <NewVersionDialog
          owner={owner}
          item={versioning}
          allowLink={allowLink}
          onClose={() => setVersioning(null)}
        />
      )}
      {renaming && (
        <RenameFileDialog owner={owner} item={renaming} onClose={() => setRenaming(null)} />
      )}
      {preview && (
        <FilePreviewDialog
          entries={preview.entries}
          index={preview.index}
          onIndexChange={(index) => setPreview({ ...preview, index })}
          onClose={() => setPreview(null)}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t(
          removing?.kind === 'version' ? 'files.removeVersionTitle' : 'files.removeItemTitle',
        )}
        body={t(removing?.kind === 'version' ? 'files.removeVersionBody' : 'files.removeItemBody', {
          label: removing?.label ?? '',
        })}
        action={t('files.removeAction')}
        destructive
        pending={archiveItem.isPending || archiveVersion.isPending}
        finalFocus={() =>
          (removing?.kind === 'item' && afterItemRemoved?.current?.isConnected
            ? afterItemRemoved.current
            : null) ?? true
        }
        onConfirm={async () => {
          if (removing?.kind === 'item') await archiveItem.mutateAsync(removing.id);
          if (removing?.kind === 'version') await archiveVersion.mutateAsync(removing.id);
          toast.add({ title: t('files.removedDone'), type: 'success' });
        }}
      />
    </>
  );

  return { actions, dialogs };
}
