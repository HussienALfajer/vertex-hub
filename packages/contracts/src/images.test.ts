import { describe, expect, it } from 'vitest';
import { IMAGE_SIZES, imagePath, imageSizeSchema, setImageSchema } from './images.js';

describe('images (spec F01C)', () => {
  const uploadId = '01900000-0000-7000-8000-000000000001';

  it('takes an upload, with a brand version for a client logo (rules 1 and 6)', () => {
    expect(setImageSchema.parse({ source: { uploadId } })).toEqual({ source: { uploadId } });
    expect(setImageSchema.parse({ source: { uploadId, brandVersionId: uploadId } }).source).toEqual(
      { uploadId, brandVersionId: uploadId },
    );
    expect(setImageSchema.safeParse({ source: { uploadId: 'x' } }).success).toBe(false);
    expect(setImageSchema.safeParse({}).success).toBe(false);
  });

  it('serves two sizes by id (rules 10–11)', () => {
    expect(IMAGE_SIZES).toEqual({ sm: 128, md: 320 });
    expect(imagePath(uploadId, 'md')).toBe(`/api/images/${uploadId}/md`);
    expect(imageSizeSchema.safeParse('lg').success).toBe(false);
  });
});
