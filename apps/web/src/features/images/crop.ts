import { IMAGE_UPLOAD_SIDE } from '@vertex-hub/contracts';

/*
 * The square crop of the image dialog (F01C rule 8), in frame units: the frame's side is 1, so the
 * same crop draws the frame, the previews at every avatar size and the uploaded square.
 */

/** The image's natural size in pixels. */
export interface ImageSize {
  width: number;
  height: number;
}

/** Frame units per image pixel, and the image's top-start corner in the frame. */
export interface Crop {
  scale: number;
  x: number;
  y: number;
}

/** The largest zoom, as a multiple of "fill the square". */
export const MAX_ZOOM = 4;

/** The scale at which the image's short side fills the frame. */
export function fillScale({ width, height }: ImageSize): number {
  return 1 / Math.min(width, height);
}

/** The scale at which the whole image fits in the frame (its long side spans it). */
export function fitScale({ width, height }: ImageSize): number {
  return 1 / Math.max(width, height);
}

/**
 * The zoom range: from "fill the square" (or, when `fit` is allowed, "the whole image fits", for
 * clients, projects and retainers) up to 4 × fill.
 */
export function scaleRange(image: ImageSize, fit: boolean): { min: number; max: number } {
  const fill = fillScale(image);
  return { min: fit ? fitScale(image) : fill, max: fill * MAX_ZOOM };
}

/** Along one axis: an image wider than the frame covers it; a narrower one stays inside it. */
function clampAxis(position: number, extent: number): number {
  return extent >= 1
    ? Math.min(0, Math.max(1 - extent, position))
    : Math.max(0, Math.min(1 - extent, position));
}

/** The crop moved back so the frame shows no gap the zoom does not leave (rule 8). */
export function clampCrop(crop: Crop, image: ImageSize): Crop {
  return {
    scale: crop.scale,
    x: clampAxis(crop.x, image.width * crop.scale),
    y: clampAxis(crop.y, image.height * crop.scale),
  };
}

/** The image filling the frame, centred. */
export function initialCrop(image: ImageSize): Crop {
  const scale = fillScale(image);
  return {
    scale,
    x: (1 - image.width * scale) / 2,
    y: (1 - image.height * scale) / 2,
  };
}

/** The crop dragged by a distance in frame units. */
export function moveCrop(crop: Crop, image: ImageSize, dx: number, dy: number): Crop {
  return clampCrop({ ...crop, x: crop.x + dx, y: crop.y + dy }, image);
}

/**
 * The crop zoomed to `scale` (kept within the range), keeping the image point under `anchor` (a
 * point of the frame, its centre by default) where it is.
 */
export function zoomCrop(
  crop: Crop,
  image: ImageSize,
  scale: number,
  fit: boolean,
  anchor = { x: 0.5, y: 0.5 },
): Crop {
  const range = scaleRange(image, fit);
  const next = Math.min(range.max, Math.max(range.min, scale));
  const ratio = next / crop.scale;
  return clampCrop(
    {
      scale: next,
      x: anchor.x - (anchor.x - crop.x) * ratio,
      y: anchor.y - (anchor.y - crop.y) * ratio,
    },
    image,
  );
}

/**
 * The uploaded square (rule 2): 1024 px, or the crop's own size in image pixels when smaller, and
 * where the image is drawn in it. Around a zoomed-out logo the square stays transparent.
 */
export function cropOutput(
  crop: Crop,
  image: ImageSize,
): { side: number; dx: number; dy: number; dw: number; dh: number } {
  const side = Math.max(1, Math.min(IMAGE_UPLOAD_SIDE, Math.round(1 / crop.scale)));
  return {
    side,
    dx: crop.x * side,
    dy: crop.y * side,
    dw: image.width * crop.scale * side,
    dh: image.height * crop.scale * side,
  };
}
