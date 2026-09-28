import { describe, expect, it } from 'vitest';
import {
  clientListQuerySchema,
  createClientSchema,
  createContactSchema,
  createNoteSchema,
  createPlatformAccountSchema,
  updateBrandKitSchema,
  updateNoteSchema,
  updatePlatformAccountSchema,
} from './clients.js';

const manager = '01a0e97d-0028-7d46-8479-9fa1ea9ffcd7';

describe('updateBrandKitSchema', () => {
  it('fills an empty kit', () => {
    expect(updateBrandKitSchema.parse({})).toEqual({
      colors: [],
      fonts: [],
      toneOfVoice: null,
      forbiddenWords: [],
      files: [],
      references: [],
    });
  });

  it('stores hex colors upper-case and refuses other formats', () => {
    expect(updateBrandKitSchema.parse({ colors: [{ hex: '#a1b2c3' }] }).colors).toEqual([
      { name: null, hex: '#A1B2C3' },
    ]);
    for (const hex of ['a1b2c3', '#abc', '#a1b2c3d4', '#g1b2c3']) {
      expect(updateBrandKitSchema.safeParse({ colors: [{ hex }] }).success, hex).toBe(false);
    }
  });

  it('keeps fonts and forbidden words once regardless of case', () => {
    const kit = updateBrandKitSchema.parse({
      fonts: ['Cairo', ' cairo '],
      forbiddenWords: ['رخيص', 'Cheap', 'CHEAP'],
    });
    expect(kit.fonts).toEqual(['Cairo']);
    expect(kit.forbiddenWords).toEqual(['رخيص', 'Cheap']);
  });

  it('enforces the limits and names the field', () => {
    const colors = Array.from({ length: 21 }, () => ({ hex: '#000000' }));
    const result = updateBrandKitSchema.safeParse({ colors });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['colors']);
    const fonts = Array.from({ length: 11 }, (_, i) => `Font ${i}`);
    expect(updateBrandKitSchema.safeParse({ fonts }).success).toBe(false);
    const words = Array.from({ length: 101 }, (_, i) => `word ${i}`);
    expect(updateBrandKitSchema.safeParse({ forbiddenWords: words }).success).toBe(false);
    expect(updateBrandKitSchema.safeParse({ toneOfVoice: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('accepts http and https links only', () => {
    const file = { kind: 'logo', label: 'Logo' };
    expect(
      updateBrandKitSchema.safeParse({ files: [{ ...file, url: ' https://drive.example/logo ' }] })
        .success,
    ).toBe(true);
    for (const url of ['ftp://files.example/logo', 'javascript:alert(1)', 'drive.example']) {
      expect(updateBrandKitSchema.safeParse({ files: [{ ...file, url }] }).success, url).toBe(
        false,
      );
    }
    const long = `https://example.com/${'x'.repeat(2030)}`;
    expect(
      updateBrandKitSchema.safeParse({ references: [{ kind: 'liked', url: long }] }).success,
    ).toBe(false);
  });
});

describe('createContactSchema', () => {
  it('normalizes phone and email and stores blanks as null', () => {
    expect(
      createContactSchema.parse({
        name: ' ليلى ',
        phone: '00963 944 123 456',
        email: ' Laila@Client.Example ',
        jobTitle: ' ',
      }),
    ).toEqual({
      name: 'ليلى',
      phone: '+963944123456',
      email: 'laila@client.example',
      jobTitle: null,
    });
    expect(createContactSchema.parse({ name: 'x', email: '' }).email).toBeNull();
  });

  it('refuses an invalid email or phone', () => {
    expect(createContactSchema.safeParse({ name: 'x', email: 'not-an-email' }).success).toBe(false);
    expect(createContactSchema.safeParse({ name: 'x', phone: '0944' }).success).toBe(false);
  });
});

describe('platform accounts', () => {
  const url = 'https://instagram.com/client';

  it('needs a label for an other platform', () => {
    expect(createPlatformAccountSchema.safeParse({ platform: 'instagram', url }).success).toBe(
      true,
    );
    expect(createPlatformAccountSchema.safeParse({ platform: 'other', url }).success).toBe(false);
    expect(
      createPlatformAccountSchema.safeParse({ platform: 'other', url, label: ' ' }).success,
    ).toBe(false);
    expect(
      createPlatformAccountSchema.safeParse({ platform: 'other', url, label: 'Telegram' }).success,
    ).toBe(true);
  });

  it('refuses clearing the label of an other platform in one update', () => {
    expect(updatePlatformAccountSchema.safeParse({ platform: 'other', label: null }).success).toBe(
      false,
    );
    expect(updatePlatformAccountSchema.safeParse({ platform: 'other' }).success).toBe(true);
  });
});

describe('notes', () => {
  it('refuses a date in the future beyond five minutes of clock skew', () => {
    const base = { channel: 'call', summary: 'Agreed on the April plan' };
    const soon = new Date(Date.now() + 60_000).toISOString();
    const later = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(createNoteSchema.safeParse({ ...base, occurredAt: soon }).success).toBe(true);
    expect(createNoteSchema.safeParse({ ...base, occurredAt: later }).success).toBe(false);
    expect(
      createNoteSchema.safeParse({ ...base, occurredAt: '2025-01-05T10:00:00+03:00' }).success,
    ).toBe(true);
    expect(updateNoteSchema.safeParse({ occurredAt: later }).success).toBe(false);
  });

  it('trims the summary and limits its length', () => {
    expect(createNoteSchema.safeParse({ channel: 'call', summary: '  ' }).success).toBe(false);
    expect(createNoteSchema.safeParse({ channel: 'call', summary: 'x'.repeat(2001) }).success).toBe(
      false,
    );
  });
});

describe('clients', () => {
  it('creates an active, non-healthcare client by default', () => {
    expect(createClientSchema.parse({ tradeName: ' Cafe ', accountManagerId: manager })).toEqual({
      tradeName: 'Cafe',
      accountManagerId: manager,
      status: 'active',
      isHealthcare: false,
    });
  });

  it('lists active and paused clients by name by default', () => {
    expect(clientListQuerySchema.parse({})).toMatchObject({
      status: ['active', 'paused'],
      archived: false,
      sort: 'tradeName',
      order: 'asc',
    });
    expect(clientListQuerySchema.parse({ status: 'ended', healthcare: 'true' })).toMatchObject({
      status: ['ended'],
      healthcare: true,
    });
    expect(clientListQuerySchema.safeParse({ status: ['active', 'gone'] }).success).toBe(false);
  });
});
