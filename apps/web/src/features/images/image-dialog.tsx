import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { IMAGE_MIN_SIDE, type ImageSubjectType, imagePath } from '@vertex-hub/contracts';
import {
  Button,
  Callout,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Progress,
  Skeleton,
  Slider,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@vertex-hub/ui';
import { CameraIcon, ImageOffIcon, PaletteIcon, UploadIcon } from 'lucide-react';
import { type PointerEvent, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import {
  fileItemsQuery,
  filePreviewUrl,
  fileThumbnailUrl,
  UploadNetworkError,
  uploadFile,
} from '../files/files.queries';
import {
  type Crop,
  cropOutput,
  fillScale,
  type ImageSize,
  initialCrop,
  moveCrop,
  scaleRange,
  zoomCrop,
} from './crop';
import { encodeSquare, isPickable, loadImage } from './image-source';
import { type ImageSubject, useSetImage } from './images.queries';

/** People are round; clients, projects and retainers square, as their avatars (rule 8). */
const isPerson = (type: ImageSubjectType) => type === 'user';

/** The image being cropped: decoded, with the brand logo version it came from. */
interface Source {
  image: HTMLImageElement;
  size: ImageSize;
  brandVersionId?: string;
  /** The object URL of a picked file, revoked when the source is dropped. */
  objectUrl?: string;
}

type Failure = { kind: 'message'; text: string } | { kind: 'cannotOpen' } | { kind: 'notAllowed' };

/**
 * The image dialog (screen 1): choose an upload or a photo (for clients also a logo from the
 * brand files), crop it square with a live preview at the avatar sizes, then upload and save it.
 */
export function ImageDialog({
  open,
  onClose,
  subject,
  imageId,
}: {
  open: boolean;
  onClose: () => void;
  subject: ImageSubject;
  /** The record's own current image, to tell when it could not be processed (edge case 4). */
  imageId: string | null;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState<Source | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const upload = useRef<AbortController | null>(null);
  const save = useSetImage(subject);
  const fit = !isPerson(subject.type);
  const lastFailed = useImageFailed(open ? imageId : null);

  function dropSource() {
    if (source?.objectUrl) URL.revokeObjectURL(source.objectUrl);
    setSource(null);
    setCrop(null);
  }

  function reset() {
    upload.current?.abort();
    upload.current = null;
    dropSource();
    setFailure(null);
    setProgress(null);
    setDecoding(false);
    save.reset();
  }

  async function openSource(url: string, origin: Pick<Source, 'brandVersionId' | 'objectUrl'>) {
    setFailure(null);
    setDecoding(true);
    try {
      const image = await loadImage(url);
      const size = { width: image.naturalWidth, height: image.naturalHeight };
      setSource({ image, size, ...origin });
      setCrop(initialCrop(size));
    } catch {
      if (origin.objectUrl) URL.revokeObjectURL(origin.objectUrl);
      setFailure({ kind: 'cannotOpen' });
    } finally {
      setDecoding(false);
    }
  }

  function pickFile(file: File) {
    if (!isPickable(file)) {
      setFailure({ kind: 'notAllowed' });
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    void openSource(objectUrl, { objectUrl });
  }

  async function submit() {
    if (!source || !crop) return;
    setFailure(null);
    if (cropOutput(crop, source.size).side < IMAGE_MIN_SIDE) {
      setFailure({ kind: 'message', text: t('errors.IMAGE_TOO_SMALL') });
      return;
    }
    const controller = new AbortController();
    upload.current = controller;
    // Busy from here: a second click must not upload twice while the square is encoded.
    setProgress(0);
    try {
      const file = await encodeSquare(source.image, crop);
      const uploaded = await uploadFile(file, {
        onProgress: setProgress,
        signal: controller.signal,
      });
      setProgress(null);
      await save.mutateAsync({
        source: {
          uploadId: uploaded.uploadId,
          ...(source.brandVersionId && { brandVersionId: source.brandVersionId }),
        },
      });
      onClose();
    } catch (error) {
      setProgress(null);
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setFailure({
        kind: 'message',
        text:
          error instanceof UploadNetworkError
            ? t('images.dialog.network')
            : error instanceof Error && !('status' in error)
              ? t('images.dialog.cannotOpen')
              : errorMessage(t, error),
      });
    } finally {
      upload.current = null;
    }
  }

  const uploading = progress !== null;
  const busy = uploading || save.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !busy && onClose()}
      onOpenChangeComplete={(next) => !next && reset()}
    >
      <DialogContent className="max-w-xl" closeLabel={busy ? undefined : t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t(`images.dialog.title.${subject.type}`)}</DialogTitle>
          <DialogDescription>
            {t(source ? 'images.dialog.cropHint' : `images.dialog.hint.${subject.type}`)}
          </DialogDescription>
        </DialogHeader>

        {source && crop ? (
          <CropStep
            source={source}
            crop={crop}
            onChange={setCrop}
            fit={fit}
            round={isPerson(subject.type)}
            disabled={busy}
          />
        ) : (
          <>
            {lastFailed && (
              <Callout
                tone="warning"
                icon={<ImageOffIcon />}
                title={t('images.dialog.lastFailed')}
                description={t('images.dialog.lastFailedHint')}
              />
            )}
            {subject.type === 'client' ? (
              <Tabs defaultValue="upload">
                <TabsList aria-label={t(`images.dialog.title.${subject.type}`)}>
                  <TabsTrigger value="upload">
                    <UploadIcon />
                    {t('images.dialog.tabs.upload')}
                  </TabsTrigger>
                  <TabsTrigger value="brand">
                    <PaletteIcon />
                    {t('images.dialog.tabs.brand')}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="upload">
                  <ChooseFile onPick={pickFile} decoding={decoding} />
                </TabsContent>
                <TabsContent value="brand">
                  <BrandLogos
                    clientId={subject.id}
                    onPick={(versionId) =>
                      openSource(filePreviewUrl(versionId), { brandVersionId: versionId })
                    }
                    decoding={decoding}
                    onClose={onClose}
                  />
                </TabsContent>
              </Tabs>
            ) : (
              <ChooseFile onPick={pickFile} decoding={decoding} />
            )}
          </>
        )}

        {uploading && (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {t('images.dialog.uploading', {
                percent: formatNumber(Math.round((progress ?? 0) * 100)),
              })}
            </p>
            <Progress
              value={(progress ?? 0) * 100}
              aria-label={t('images.dialog.uploadProgress')}
            />
          </div>
        )}
        {failure && (
          <FormAlert>
            {failure.kind === 'message'
              ? failure.text
              : failure.kind === 'cannotOpen'
                ? t('images.dialog.cannotOpen')
                : t('errors.IMAGE_TYPE_NOT_ALLOWED')}
          </FormAlert>
        )}

        {source && (
          <DialogFooter>
            {uploading ? (
              <Button variant="outline" onClick={() => upload.current?.abort()}>
                {t('images.dialog.cancelUpload')}
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  dropSource();
                  setFailure(null);
                }}
              >
                {t('images.dialog.chooseAnother')}
              </Button>
            )}
            <Button disabled={busy} onClick={submit}>
              {save.isPending ? t('images.dialog.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Whether the record's current image cannot be shown: it failed to render (edge case 4). */
function useImageFailed(imageId: string | null): boolean {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (!imageId) return;
    let live = true;
    loadImage(imagePath(imageId, 'sm')).catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [imageId]);
  return failed;
}

function ChooseFile({ onPick, decoding }: { onPick: (file: File) => void; decoding: boolean }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <CameraIcon className="size-8 text-muted-foreground" aria-hidden="true" />
      <p id={hintId} className="text-sm text-muted-foreground">
        {t('images.dialog.chooseHint')}
      </p>
      {/* `image/*` lets a phone offer its camera next to its gallery (rule 8). */}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onPick(file);
        }}
      />
      <Button aria-describedby={hintId} disabled={decoding} onClick={() => input.current?.click()}>
        <UploadIcon />
        {decoding ? t('images.dialog.opening') : t('images.dialog.choose')}
      </Button>
    </div>
  );
}

/**
 * The client's logo brand files whose latest version is an upload with a rendered preview
 * (rule 6), as thumbnails; picking one crops its 1600 px preview.
 */
function BrandLogos({
  clientId,
  onPick,
  decoding,
  onClose,
}: {
  clientId: string;
  onPick: (versionId: string) => void;
  decoding: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const files = useQuery(fileItemsQuery({ ownerType: 'client', ownerId: clientId, role: 'brand' }));
  if (files.isPending) {
    return (
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="aspect-square rounded-lg" />
        ))}
      </div>
    );
  }
  if (files.isError) return <FormAlert>{t('images.dialog.brandLoadError')}</FormAlert>;
  const logos = files.data.items.flatMap((item) => {
    const latest = item.versions[0];
    return item.brandKind === 'logo' &&
      !item.archivedAt &&
      latest &&
      latest.kind === 'upload' &&
      latest.previewStatus === 'ready'
      ? [{ item, version: latest }]
      : [];
  });
  if (logos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
        <p className="font-medium">{t('images.dialog.noLogos')}</p>
        <Link
          to="/clients/$clientId"
          params={{ clientId }}
          search={{ tab: 'brand-kit' }}
          className="text-sm underline underline-offset-4"
          onClick={onClose}
        >
          {t('images.dialog.openBrandKit')}
        </Link>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
      {logos.map(({ item, version }) => (
        <li key={item.id}>
          <button
            type="button"
            disabled={decoding}
            onClick={() => onPick(version.id)}
            className="flex w-full flex-col gap-1.5 rounded-lg border border-border p-2 text-start hover:bg-muted disabled:opacity-50"
          >
            <img
              src={fileThumbnailUrl(version.id)}
              alt=""
              className="aspect-square w-full rounded-md bg-avatar-image object-contain"
            />
            <span className="truncate text-sm">{item.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The share of the frame a key press moves the image. */
const KEY_STEP = 0.02;

/**
 * The square frame over the image (round for people), with drag or pinch to move and zoom and a
 * zoom slider (rule 8), and the result at the avatar sizes.
 */
function CropStep({
  source,
  crop,
  onChange,
  fit,
  round,
  disabled,
}: {
  source: Source;
  crop: Crop;
  onChange: (crop: Crop) => void;
  fit: boolean;
  round: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const frame = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const { size } = source;
  const fill = fillScale(size);
  const range = scaleRange(size, fit);

  function frameSide() {
    return frame.current?.getBoundingClientRect().width || 1;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const side = frameSide();
    const others = [...pointers.current.entries()].filter(([id]) => id !== event.pointerId);
    const current = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, current);
    const other = others[0]?.[1];
    if (other) {
      // Pinch: the distance between the two fingers scales the image around their midpoint.
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(current.x - other.x, current.y - other.y);
      if (before === 0) return;
      const box = frame.current?.getBoundingClientRect();
      const anchor = box
        ? {
            x: ((current.x + other.x) / 2 - box.left) / side,
            y: ((current.y + other.y) / 2 - box.top) / side,
          }
        : undefined;
      onChange(zoomCrop(crop, size, (crop.scale * after) / before, fit, anchor));
      return;
    }
    onChange(
      moveCrop(crop, size, (current.x - previous.x) / side, (current.y - previous.y) / side),
    );
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
  }

  // The frame keeps the image's physical position: dragging right moves it right in both directions.
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <div className="flex flex-1 flex-col gap-4">
        <div
          ref={frame}
          role="application"
          tabIndex={disabled ? -1 : 0}
          aria-label={t('images.dialog.frame')}
          dir="ltr"
          className={cn(
            'relative mx-auto aspect-square w-full max-w-72 touch-none overflow-hidden bg-avatar-image select-none',
            'cursor-grab active:cursor-grabbing',
            round ? 'rounded-full' : 'rounded-lg',
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(event) => {
            const moves: Record<string, [number, number]> = {
              ArrowLeft: [-KEY_STEP, 0],
              ArrowRight: [KEY_STEP, 0],
              ArrowUp: [0, -KEY_STEP],
              ArrowDown: [0, KEY_STEP],
            };
            const move = moves[event.key];
            if (!move || disabled) return;
            event.preventDefault();
            onChange(moveCrop(crop, size, move[0], move[1]));
          }}
        >
          <CropView source={source} crop={crop} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('images.dialog.zoom')}</span>
          <Slider
            thumbLabel={t('images.dialog.zoom')}
            valueText={(value) =>
              t('images.dialog.zoomValue', { percent: formatNumber(Math.round(value * 100)) })
            }
            min={range.min / fill}
            max={range.max / fill}
            step={0.01}
            value={crop.scale / fill}
            disabled={disabled}
            onValueChange={(value) => onChange(zoomCrop(crop, size, value * fill, fit))}
          />
          {fit && <p className="text-sm text-muted-foreground">{t('images.dialog.fitHint')}</p>}
        </div>
      </div>
      <div className="flex flex-col items-center gap-3 sm:w-28">
        <span className="text-sm font-medium">{t('images.dialog.preview')}</span>
        <div className="flex items-end gap-3 sm:flex-col sm:items-center">
          {(['size-20', 'size-14', 'size-9'] as const).map((sizeClass) => (
            <div
              key={sizeClass}
              aria-hidden="true"
              dir="ltr"
              className={cn(
                'relative shrink-0 overflow-hidden bg-avatar-image',
                sizeClass,
                round ? 'rounded-full' : 'rounded-lg',
              )}
            >
              <CropView source={source} crop={crop} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The image placed by the crop in a box of any size: positions are shares of the box's side. */
function CropView({ source, crop }: { source: Source; crop: Crop }) {
  return (
    <img
      src={source.image.src}
      alt=""
      draggable={false}
      className="pointer-events-none absolute max-w-none"
      style={{
        insetInlineStart: `${crop.x * 100}%`,
        top: `${crop.y * 100}%`,
        width: `${source.size.width * crop.scale * 100}%`,
        height: `${source.size.height * crop.scale * 100}%`,
      }}
    />
  );
}
