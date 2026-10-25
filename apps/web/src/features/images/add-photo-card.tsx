import { Button, Card, IconTile } from '@vertex-hub/ui';
import { CameraIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageDialog } from './image-dialog';

/** Rule 16: "Not now" hides the card in this browser, per user. */
const dismissedKey = (userId: string) => `vertex-hub-add-photo-dismissed:${userId}`;

function readDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(dismissedKey(userId)) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(userId: string) {
  try {
    localStorage.setItem(dismissedKey(userId), '1');
  } catch {
    // A blocked storage only shows the card again next time.
  }
}

/** "Add your photo" on My account while the user has none (rule 16); it never notifies. */
export function AddPhotoCard({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() => readDismissed(userId));
  const [editing, setEditing] = useState(false);
  if (dismissed) return null;
  return (
    <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <IconTile>
        <CameraIcon />
      </IconTile>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="font-bold">{t('images.addPhoto.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('images.addPhoto.body')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            writeDismissed(userId);
            setDismissed(true);
          }}
        >
          {t('images.addPhoto.notNow')}
        </Button>
        <Button onClick={() => setEditing(true)}>{t('images.actions.user.add')}</Button>
      </div>
      <ImageDialog
        open={editing}
        onClose={() => setEditing(false)}
        subject={{ type: 'user', id: userId }}
        imageId={null}
      />
    </Card>
  );
}
