import { type ImageSize, imagePath } from '@vertex-hub/contracts';
import type { AvatarProps } from '@vertex-hub/ui';

/** The rendition an avatar size shows: the medium one for `lg` and `xl` (F01C rule 12). */
export function renditionFor(size: AvatarProps['size']): ImageSize {
  return size === 'lg' || size === 'xl' ? 'md' : 'sm';
}

/** The `src` of an avatar showing a record's current image, null for its initial. */
export function imageSrc(
  imageId: string | null | undefined,
  size: AvatarProps['size'] = 'md',
): string | null {
  return imageId ? imagePath(imageId, renditionFor(size)) : null;
}
