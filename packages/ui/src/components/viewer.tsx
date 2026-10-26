import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DownloadIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  type WheelEvent,
} from 'react';
import { cn } from '../lib/cn';
import { dialogMotion, overlayMotion } from '../lib/motion';
import { Button } from './button';
import { IconButton } from './icon-button';

/*
 * The built-in viewer (F06B rule C4): images and videos of one set, full screen, with previous and
 * next, zoom and pan for images, the browser's player for videos and a download. The app passes
 * the files and every label; the viewer reads no data of its own.
 */

/** One file of the set. */
export interface ViewerItem {
  /** Stable across renders: the item's id. */
  key: string;
  kind: 'image' | 'video';
  /** What the viewer shows: the preview of an image, the content of a video. */
  src: string;
  name: string;
  /** Who and what (version, role, uploader), shown under the name. */
  details?: ReactNode;
  downloadHref?: string;
}

export interface ViewerLabels {
  close: string;
  previous: string;
  next: string;
  zoomIn: string;
  zoomOut: string;
  /** Resets the zoom; shown as the current zoom level. */
  resetZoom: string;
  download: string;
  /** "2 of 5". */
  position: (current: number, total: number) => string;
}

const ZOOM = { min: 1, max: 4, step: 0.5 } as const;

interface ViewerProps {
  items: readonly ViewerItem[];
  /** The shown item; null closes the viewer. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  labels: ViewerLabels;
  /** Arrows follow the reading direction: in RTL the next item is to the left. */
  dir?: 'rtl' | 'ltr';
}

function Viewer({ items, index, onIndexChange, onClose, labels, dir = 'rtl' }: ViewerProps) {
  const item = index === null ? undefined : items[index];
  const position = index ?? 0;
  const hasPrevious = position > 0;
  const hasNext = position < items.length - 1;
  const [zoom, setZoom] = useState<number>(ZOOM.min);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null);

  // Each item opens unzoomed.
  const key = item?.key;
  useEffect(() => {
    if (key === undefined) return;
    setZoom(ZOOM.min);
    setOffset({ x: 0, y: 0 });
  }, [key]);

  const zoomTo = (next: number) => {
    const clamped = Math.min(ZOOM.max, Math.max(ZOOM.min, next));
    setZoom(clamped);
    if (clamped === ZOOM.min) setOffset({ x: 0, y: 0 });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    // A video keeps its own arrow keys (seeking).
    if ((event.target as HTMLElement).tagName === 'VIDEO') return;
    if (event.key === forward && hasNext) onIndexChange(position + 1);
    else if (event.key === back && hasPrevious) onIndexChange(position - 1);
    else if (item?.kind === 'image' && (event.key === '+' || event.key === '=')) {
      zoomTo(zoom + ZOOM.step);
    } else if (item?.kind === 'image' && event.key === '-') zoomTo(zoom - ZOOM.step);
  };

  const onWheel = (event: WheelEvent) => {
    if (item?.kind !== 'image') return;
    zoomTo(zoom + (event.deltaY < 0 ? ZOOM.step : -ZOOM.step));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (zoom === ZOOM.min) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, from: offset };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    setOffset({
      x: start.from.x + event.clientX - start.x,
      y: start.from.y + event.clientY - start.y,
    });
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <DialogPrimitive.Root open={item !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          data-slot="viewer-overlay"
          className={cn('fixed inset-0 z-50 bg-overlay', overlayMotion)}
        />
        <DialogPrimitive.Popup
          data-slot="viewer"
          onKeyDown={onKeyDown}
          className={cn(
            'fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none',
            dialogMotion,
          )}
        >
          {item && (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <DialogPrimitive.Title
                    className="truncate text-base font-bold"
                    data-slot="viewer-title"
                  >
                    <bdi>{item.name}</bdi>
                  </DialogPrimitive.Title>
                  {item.details && (
                    <div className="truncate text-sm text-muted-foreground">{item.details}</div>
                  )}
                </div>
                {item.kind === 'image' && (
                  <div className="flex items-center gap-1">
                    <IconButton
                      label={labels.zoomOut}
                      disabled={zoom <= ZOOM.min}
                      focusableWhenDisabled
                      onClick={() => zoomTo(zoom - ZOOM.step)}
                    >
                      <ZoomOutIcon />
                    </IconButton>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={labels.resetZoom}
                      className="min-w-14 tabular-nums"
                      onClick={() => zoomTo(ZOOM.min)}
                    >
                      <span dir="ltr">{`${Math.round(zoom * 100)}%`}</span>
                    </Button>
                    <IconButton
                      label={labels.zoomIn}
                      disabled={zoom >= ZOOM.max}
                      focusableWhenDisabled
                      onClick={() => zoomTo(zoom + ZOOM.step)}
                    >
                      <ZoomInIcon />
                    </IconButton>
                  </div>
                )}
                {item.downloadHref && (
                  <Button variant="outline" size="sm" render={<a href={item.downloadHref} />}>
                    <DownloadIcon />
                    {labels.download}
                  </Button>
                )}
                <DialogPrimitive.Close render={<IconButton label={labels.close} variant="ghost" />}>
                  <XIcon />
                </DialogPrimitive.Close>
              </div>
              <div
                className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted"
                onWheel={onWheel}
              >
                {item.kind === 'image' ? (
                  <div
                    data-slot="viewer-stage"
                    className={cn(
                      'flex size-full items-center justify-center touch-none select-none',
                      zoom > ZOOM.min ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
                    )}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  >
                    <img
                      src={item.src}
                      alt={item.name}
                      draggable={false}
                      className="max-h-full max-w-full object-contain transition-transform duration-150 ease-out"
                      style={{
                        transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                      }}
                    />
                  </div>
                ) : (
                  // biome-ignore lint/a11y/useMediaCaption: team work files have no captions to offer
                  <video
                    key={item.key}
                    src={item.src}
                    controls
                    preload="metadata"
                    className="max-h-full max-w-full"
                  />
                )}
              </div>
              {items.length > 1 && (
                <div className="flex items-center justify-center gap-3 border-t border-border px-4 py-2">
                  <IconButton
                    label={labels.previous}
                    disabled={!hasPrevious}
                    focusableWhenDisabled
                    onClick={() => onIndexChange(position - 1)}
                  >
                    <ArrowRightIcon className="ltr:-scale-x-100" />
                  </IconButton>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {labels.position(position + 1, items.length)}
                  </span>
                  <IconButton
                    label={labels.next}
                    disabled={!hasNext}
                    focusableWhenDisabled
                    onClick={() => onIndexChange(position + 1)}
                  >
                    <ArrowLeftIcon className="ltr:-scale-x-100" />
                  </IconButton>
                </div>
              )}
            </>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export { Viewer };
