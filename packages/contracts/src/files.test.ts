import { describe, expect, it } from 'vitest';
import {
  createFileItemSchema,
  createFileVersionSchema,
  DEFAULT_FILE_NAME,
  defaultFileItemName,
  fileLibraryQuerySchema,
  fileTypeOf,
  isBlockedFile,
  isInlineMimeType,
  isPreviewableMimeType,
  updateFileItemSchema,
} from './files.js';

const ownerId = '01a0e97d-0028-7d46-8479-9fa1ea9ffcd7';
const uploadId = '01a0e97d-0028-7d46-8479-9fa1ea9ffcd8';

const deliverable = {
  ownerType: 'task',
  ownerId,
  role: 'deliverable',
  source: { uploadId },
} as const;

describe('createFileItemSchema', () => {
  it('takes an upload or a link as its source', () => {
    expect(createFileItemSchema.parse(deliverable).source).toEqual({ uploadId });
    const link = createFileItemSchema.parse({
      ...deliverable,
      source: { url: ' https://drive.google.com/x ', label: '  ' },
    });
    expect(link.source).toEqual({ url: 'https://drive.google.com/x', label: null });
    for (const url of ['ftp://a.com/x', 'javascript:alert(1)', 'not a url']) {
      expect(createFileItemSchema.safeParse({ ...deliverable, source: { url } }).success, url).toBe(
        false,
      );
    }
    expect(createFileItemSchema.safeParse({ ...deliverable, source: {} }).success).toBe(false);
  });

  it('trims names and keeps them within 120 characters', () => {
    expect(createFileItemSchema.parse({ ...deliverable, name: '  Poster ' }).name).toBe('Poster');
    expect(createFileItemSchema.safeParse({ ...deliverable, name: '   ' }).success).toBe(false);
    expect(createFileItemSchema.safeParse({ ...deliverable, name: 'a'.repeat(121) }).success).toBe(
      false,
    );
  });

  it('allows each role only on its owner types', () => {
    const cases = [
      ['task', 'deliverable', true],
      ['task', 'reference', true],
      ['task', 'document', false],
      ['client', 'brand', true],
      ['client', 'document', true],
      ['client', 'deliverable', false],
      ['project', 'document', true],
      ['project', 'brand', false],
      ['retainer', 'document', true],
      ['retainer', 'reference', false],
    ] as const;
    for (const [ownerType, role, ok] of cases) {
      const brandKind = role === 'brand' ? 'logo' : undefined;
      const result = createFileItemSchema.safeParse({ ...deliverable, ownerType, role, brandKind });
      expect(result.success, `${ownerType}/${role}`).toBe(ok);
    }
  });

  it('requires a brand kind on brand files and only there', () => {
    const brand = { ...deliverable, ownerType: 'client', role: 'brand' } as const;
    expect(createFileItemSchema.safeParse(brand).success).toBe(false);
    expect(createFileItemSchema.safeParse({ ...brand, brandKind: 'logo' }).success).toBe(true);
    expect(createFileItemSchema.safeParse({ ...deliverable, brandKind: 'logo' }).success).toBe(
      false,
    );
  });

  it('marks only documents confidential', () => {
    expect(createFileItemSchema.parse(deliverable).confidential).toBe(false);
    expect(createFileItemSchema.safeParse({ ...deliverable, confidential: true }).success).toBe(
      false,
    );
    const document = { ...deliverable, ownerType: 'project', role: 'document' } as const;
    expect(createFileItemSchema.parse({ ...document, confidential: true }).confidential).toBe(true);
  });
});

describe('updateFileItemSchema and createFileVersionSchema', () => {
  it('refuses an empty change', () => {
    expect(updateFileItemSchema.safeParse({}).success).toBe(false);
    expect(updateFileItemSchema.parse({ confidential: false })).toEqual({ confidential: false });
  });

  it('keeps notes within 500 characters, blank as null', () => {
    expect(createFileVersionSchema.parse({ note: ' ', source: { uploadId } }).note).toBeNull();
    expect(
      createFileVersionSchema.safeParse({ note: 'a'.repeat(501), source: { uploadId } }).success,
    ).toBe(false);
  });
});

describe('fileLibraryQuerySchema', () => {
  it('takes a month as YYYY-MM', () => {
    const base = { clientId: ownerId };
    expect(fileLibraryQuerySchema.parse({ ...base, month: '2026-09' }).month).toBe('2026-09');
    for (const month of ['2026-13', '2026-9', '202609']) {
      expect(fileLibraryQuerySchema.safeParse({ ...base, month }).success, month).toBe(false);
    }
  });
});

describe('file rules', () => {
  it('classifies versions for the library filter', () => {
    expect(fileTypeOf('link', null)).toBe('link');
    expect(fileTypeOf('upload', 'image/heic')).toBe('image');
    expect(fileTypeOf('upload', 'video/mp4')).toBe('video');
    expect(fileTypeOf('upload', 'application/pdf')).toBe('pdf');
    expect(fileTypeOf('upload', 'application/zip')).toBe('other');
  });

  it('serves inline only the safe preview types', () => {
    for (const type of ['image/png', 'application/pdf', 'video/quicktime']) {
      expect(isInlineMimeType(type), type).toBe(true);
    }
    for (const type of ['image/svg+xml', 'text/html', 'image/tiff', null]) {
      expect(isInlineMimeType(type), String(type)).toBe(false);
    }
  });

  it('previews raster images and SVG only', () => {
    expect(isPreviewableMimeType('image/svg+xml')).toBe(true);
    expect(isPreviewableMimeType('image/tiff')).toBe(true);
    expect(isPreviewableMimeType('image/heic')).toBe(false);
    expect(isPreviewableMimeType('application/pdf')).toBe(false);
  });

  it('blocks executables by extension and by detected type', () => {
    expect(isBlockedFile('setup.EXE', null)).toBe(true);
    expect(isBlockedFile('run.sh', 'text/plain')).toBe(true);
    expect(isBlockedFile('photo.jpg', 'application/x-msdownload')).toBe(true);
    expect(isBlockedFile('brief.pdf', 'application/pdf')).toBe(false);
    expect(isBlockedFile('exe', null)).toBe(false);
  });

  it('names an item after its source', () => {
    expect(defaultFileItemName({ originalName: 'launch.poster.png' })).toBe('launch.poster');
    expect(defaultFileItemName({ originalName: 'README' })).toBe('README');
    expect(defaultFileItemName({ originalName: '.png' })).toBe(DEFAULT_FILE_NAME);
    expect(defaultFileItemName({ url: 'https://drive.google.com/x', label: null })).toBe(
      'drive.google.com',
    );
    expect(defaultFileItemName({ url: 'https://a.com', label: 'Raw footage' })).toBe('Raw footage');
    expect(defaultFileItemName({ originalName: `${'a'.repeat(200)}.mp4` })).toHaveLength(120);
  });
});
