import { Button } from '@vertex-hub/ui';
import { ImageIcon, ImagePlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { ImageDialog } from './image-dialog';
import { type ImageSubject, useRemoveImage } from './images.queries';

/**
 * "Change photo" (logo, image) and "Remove" for a record's own image (screens 2–5), with the image
 * dialog and the remove confirmation. Show it only to those who may change the image: the API
 * enforces it.
 */
export function ImageActions({
  subject,
  imageId,
  showsClientLogo = false,
}: {
  subject: ImageSubject;
  /** The record's own current image, null when it shows its initial or its client's logo. */
  imageId: string | null;
  /** A project or retainer without its own image showing its client's logo (rule 3). */
  showsClientLogo?: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const remove = useRemoveImage(subject);
  const label =
    !imageId && showsClientLogo && (subject.type === 'project' || subject.type === 'retainer')
      ? t(`images.actions.${subject.type}.useOwn`)
      : t(`images.actions.${subject.type}.${imageId ? 'change' : 'add'}`);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
        <ImageIcon />
        {label}
      </Button>
      {imageId && (
        <Button variant="ghost" size="sm" onClick={() => setRemoving(true)}>
          <Trash2Icon />
          {t('images.actions.remove')}
        </Button>
      )}
      <ImageDialog
        open={editing}
        onClose={() => setEditing(false)}
        subject={subject}
        imageId={imageId}
      />
      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        title={t(`images.remove.${subject.type}.title`)}
        body={t(`images.remove.${subject.type}.body`)}
        action={t('images.actions.remove')}
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutateAsync().then(() => undefined)}
      />
    </div>
  );
}

/**
 * Rule 7: in place of a client's initial, while it has no logo and the actor may set one, a tile
 * that opens the image dialog (the brand logos are a tab away).
 */
export function ChooseLogoTile({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex size-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-input text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ImagePlusIcon className="size-5" aria-hidden="true" />
        {t('images.actions.client.add')}
      </button>
      <ImageDialog
        open={editing}
        onClose={() => setEditing(false)}
        subject={{ type: 'client', id: clientId }}
        imageId={null}
      />
    </>
  );
}
