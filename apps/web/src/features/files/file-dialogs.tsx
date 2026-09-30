import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  FILE_NOTE_MAX,
  type FileItem,
  type FileRole,
  type FileSource,
  type UpdateFileItem,
  updateFileItemSchema,
} from '@vertex-hub/contracts';
import {
  Button,
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
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { useCallback, useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { errorMessage } from '../../lib/errors';
import {
  type FileOwnerRef,
  useAddFileVersion,
  useCreateFileItem,
  useUpdateFileItem,
} from './files.queries';
import { UploadControl } from './upload-control';

/** "What changed", sent with every file added from the dialog. */
function NoteField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t('files.note')}</FieldLabel>
      <Textarea
        id={id}
        rows={2}
        maxLength={FILE_NOTE_MAX}
        placeholder={t('files.notePlaceholder')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/**
 * Adds new items of one role: one item per file, or one from a link. Closes once everything the
 * user added is attached.
 */
export function AddFilesDialog({
  owner,
  fileRole,
  title,
  description,
  withNote,
  allowLink,
  onClose,
}: {
  owner: FileOwnerRef;
  fileRole: FileRole;
  title: string;
  description: string;
  withNote?: boolean;
  allowLink?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const create = useCreateFileItem(owner);
  const [note, setNote] = useState('');
  const onAttach = (source: FileSource, name?: string) =>
    create.mutateAsync({ role: fileRole, source, name, note: note.trim() || undefined });
  const onDone = useCallback(() => {
    toast.add({ title: t('files.added'), type: 'success' });
    onClose();
  }, [t, onClose]);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {withNote && <NoteField value={note} onChange={setNote} />}
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
