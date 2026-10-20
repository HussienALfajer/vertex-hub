import { afterEach, describe, expect, it, vi } from 'vitest';
import { applePlatform, dismissInstallCard, installCardDismissed } from './install';

const IPHONE_17 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
const IPHONE_16_3 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

describe('applePlatform (F16 rule A3)', () => {
  it('tells iPhones that can get notifications from older ones', () => {
    expect(applePlatform(IPHONE_17, 5)).toEqual({ apple: true, pushCapable: true });
    expect(applePlatform(IPHONE_16_3, 5)).toEqual({ apple: true, pushCapable: false });
  });

  it('sees an iPad that presents itself as a Mac', () => {
    expect(applePlatform(IPAD_AS_MAC, 5)).toEqual({ apple: true, pushCapable: true });
    expect(applePlatform(IPAD_AS_MAC, 0).apple).toBe(false);
  });

  it('is not Apple on Android', () => {
    expect(applePlatform(ANDROID, 5).apple).toBe(false);
  });
});

describe('install card dismissal', () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  afterEach(() => store.clear());

  it('hides the card for 30 days', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(installCardDismissed(0)).toBe(false);
    dismissInstallCard(1000);
    expect(installCardDismissed(1000 + 29 * day)).toBe(true);
    expect(installCardDismissed(1000 + 30 * day)).toBe(false);
  });
});
