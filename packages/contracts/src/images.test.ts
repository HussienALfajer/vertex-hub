import { describe, expect, it } from 'vitest';
import { attendanceGreetingSchema } from './attendance.js';
import {
  clientRefSchema,
  engagementRefSchema,
  IMAGE_SIZES,
  imagePath,
  imageSizeSchema,
  personSchema,
  setImageSchema,
} from './images.js';
import { notificationSchema } from './notifications.js';

describe('images (spec F01C)', () => {
  const uploadId = '01900000-0000-7000-8000-000000000001';
  const uuid = uploadId;

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

  it('gives every person, client, project and retainer reference its image, or null', () => {
    const ref = { id: uuid, name: 'سارة', imageId: uuid };
    for (const schema of [personSchema, clientRefSchema, engagementRefSchema]) {
      expect(schema.parse(ref)).toEqual(ref);
      expect(schema.parse({ ...ref, imageId: null }).imageId).toBeNull();
      expect(schema.safeParse({ id: uuid, name: 'سارة' }).success).toBe(false);
      expect(schema.safeParse({ ...ref, imageId: 'x' }).success).toBe(false);
    }
  });

  it("reads a notification's actor without a photo as one queued before F01C", () => {
    const parsed = notificationSchema.parse({
      id: uuid,
      type: 'profile_changed',
      actor: { id: uuid, name: 'هبة' },
      subject: { type: 'user', id: uuid },
      data: { changes: ['photo'] },
      count: 1,
      read: false,
      createdAt: '2026-10-25T09:00:00.000Z',
      updatedAt: '2026-10-25T09:00:00.000Z',
    });
    expect(parsed.actor).toEqual({ id: uuid, name: 'هبة', imageId: null });
  });

  it('carries the greeting photo as an image data URL, or null (rule 15)', () => {
    const greeting = {
      direction: 'out',
      firstName: 'سامر',
      partOfDay: null,
      tasksDueToday: null,
      firstEventAt: null,
      workedMinutes: 480,
    };
    const photo = 'data:image/webp;base64,UklGRg==';
    expect(attendanceGreetingSchema.parse({ ...greeting, photo }).photo).toBe(photo);
    expect(attendanceGreetingSchema.parse({ ...greeting, photo: null }).photo).toBeNull();
    expect(
      attendanceGreetingSchema.safeParse({ ...greeting, photo: 'https://x.test/a.png' }).success,
    ).toBe(false);
  });
});
