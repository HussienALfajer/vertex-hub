import { IMAGE_MIME_TYPES } from '@vertex-hub/contracts';
import { type Crop, cropOutput } from './crop';

/**
 * Picked files the browser decodes and re-encodes (rule 9): the accepted types, the iPhone's HEIC,
 * and files whose type the browser does not report. A GIF, SVG or any other type is refused as
 * the API would refuse it.
 */
const PICKABLE_TYPES: readonly string[] = [...IMAGE_MIME_TYPES, 'image/heic', 'image/heif', ''];

export function isPickable(file: File): boolean {
  return PICKABLE_TYPES.includes(file.type);
}

/**
 * A picked file as a `data:` URL: the app's CSP allows `data:` images, not `blob:` ones
 * (`deploy/nginx/vertexhub-csp.conf`).
 */
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** The image decoded by the browser; rejects when it cannot open it (rule 9, edge case 11). */
export async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('The image has no size');
  return image;
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
}

/**
 * The square to upload (rule 2): a WebP, or a PNG where the browser cannot encode WebP, both
 * keeping the transparency around a zoomed-out logo.
 */
export async function encodeSquare(image: HTMLImageElement, crop: Crop): Promise<File> {
  const size = { width: image.naturalWidth, height: image.naturalHeight };
  const { side, dx, dy, dw, dh } = cropOutput(crop, size);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, dx, dy, dw, dh);
  const webp = await toBlob(canvas, 'image/webp');
  const blob = webp?.type === 'image/webp' ? webp : await toBlob(canvas, 'image/png');
  if (!blob) throw new Error('The image could not be encoded');
  const extension = blob.type === 'image/webp' ? 'webp' : 'png';
  return new File([blob], `image.${extension}`, { type: blob.type });
}
