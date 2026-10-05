import { describe, expect, it } from 'vitest';
import { deviceOf } from './devices.js';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const EDGE_WINDOWS = `${CHROME_WINDOWS} Edg/141.0.0.0`;
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const FIREFOX_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.6; rv:143.0) Gecko/20100101 Firefox/143.0';

describe('devices (F14 email rule 15)', () => {
  it('reads the browser and the system families', () => {
    expect(deviceOf(CHROME_WINDOWS).label).toBe('Chrome · Windows');
    expect(deviceOf(EDGE_WINDOWS).label).toBe('Edge · Windows');
    expect(deviceOf(SAFARI_IPHONE).label).toBe('Safari · iOS');
    expect(deviceOf(CHROME_ANDROID).label).toBe('Chrome · Android');
    expect(deviceOf(FIREFOX_MAC).label).toBe('Firefox · macOS');
  });

  it('ignores versions, so an update is the same device', () => {
    expect(deviceOf(CHROME_WINDOWS.replaceAll('141', '142'))).toEqual(deviceOf(CHROME_WINDOWS));
  });

  it('names an unknown or missing user agent as unknown (edge case 16)', () => {
    expect(deviceOf('curl/8.5.0').label).toBe('Unknown browser · Unknown system');
    expect(deviceOf(null).label).toBe('Unknown browser · Unknown system');
  });
});
