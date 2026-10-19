import { describe, expect, it } from 'vitest';
import {
  deviceMatch,
  deviceOf,
  hardwareIdentity,
  hardwareSignalsSchema,
  normalizeGpu,
  type SessionKeys,
} from './devices.js';

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

/* F01B rule 5: GPU strings as each browser reports them on the same machine. */
const GPU_STRINGS = {
  nvidia: {
    chrome: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    edge: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    firefox: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0), or similar',
    expected: 'nvidia geforce rtx 3060',
  },
  intel: {
    chrome: 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    edge: 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    firefox: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0), or similar',
    expected: 'intel uhd graphics 620',
  },
  amdD3d9: {
    chrome: 'ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D9Ex vs_3_0 ps_3_0, aticfx64.dll)',
    edge: 'ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D9Ex vs_3_0 ps_3_0, aticfx64.dll)',
    firefox: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0), or similar',
    expected: 'amd radeon rx 6600',
  },
  appleM1: {
    chrome: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)',
    edge: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)',
    firefox: 'Apple M1, or similar',
    expected: 'apple m1',
  },
  linuxMesa: {
    chrome: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)',
    edge: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)',
    firefox: 'Mesa Intel(R) UHD Graphics 620 (KBL GT2), or similar',
    expected: 'mesa intel uhd graphics 620 (kbl gt2)',
  },
};

const SIGNALS = {
  cores: 8,
  timeZone: 'Asia/Damascus',
  screen: { long: 1920, short: 1080 },
  gpu: GPU_STRINGS.nvidia.chrome,
};

const FIREFOX_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';

describe('hardware key (F01B rule 5)', () => {
  it('names the same GPU alike in Chrome, Edge and Firefox', () => {
    for (const { chrome, edge, firefox, expected } of Object.values(GPU_STRINGS)) {
      expect(normalizeGpu(chrome)).toBe(expected);
      expect(normalizeGpu(edge)).toBe(expected);
      expect(normalizeGpu(firefox)).toBe(expected);
    }
  });

  it('treats a hidden or empty GPU as unknown', () => {
    expect(normalizeGpu(null)).toBeNull();
    expect(normalizeGpu('  ')).toBeNull();
    expect(normalizeGpu('Unknown')).toBeNull();
  });

  it('gives the same identity from every browser on the machine', () => {
    const chrome = hardwareIdentity(SIGNALS, CHROME_WINDOWS);
    expect(chrome).toBe('v1|windows|8|Asia/Damascus|1920x1080|nvidia geforce rtx 3060');
    expect(hardwareIdentity({ ...SIGNALS, gpu: GPU_STRINGS.nvidia.edge }, EDGE_WINDOWS)).toBe(
      chrome,
    );
    expect(hardwareIdentity({ ...SIGNALS, gpu: GPU_STRINGS.nvidia.firefox }, FIREFOX_WINDOWS)).toBe(
      chrome,
    );
  });

  it('tells machines apart by any signal', () => {
    const chrome = hardwareIdentity(SIGNALS, CHROME_WINDOWS);
    expect(hardwareIdentity({ ...SIGNALS, cores: 4 }, CHROME_WINDOWS)).not.toBe(chrome);
    expect(
      hardwareIdentity({ ...SIGNALS, screen: { long: 2560, short: 1440 } }, CHROME_WINDOWS),
    ).not.toBe(chrome);
    expect(hardwareIdentity(SIGNALS, CHROME_ANDROID)).not.toBe(chrome);
  });

  it('gives no identity with fewer than three known signals (edge case 8)', () => {
    const hidden = { cores: null, timeZone: null, screen: null, gpu: null };
    expect(hardwareIdentity({ ...hidden, cores: 8 }, CHROME_WINDOWS)).toBeNull();
    expect(hardwareIdentity({ ...hidden, cores: 8, gpu: 'Unknown' }, CHROME_WINDOWS)).toBeNull();
    expect(hardwareIdentity({ ...hidden, cores: 8, timeZone: 'UTC' }, CHROME_WINDOWS)).toBe(
      'v1|windows|8|UTC|?|?',
    );
    expect(hardwareIdentity({ ...hidden, cores: 8, timeZone: 'UTC' }, 'curl/8.5.0')).toBeNull();
  });

  it('checks the reported signals', () => {
    expect(hardwareSignalsSchema.safeParse(SIGNALS).success).toBe(true);
    expect(hardwareSignalsSchema.safeParse({ ...SIGNALS, cores: 0 }).success).toBe(false);
    expect(hardwareSignalsSchema.safeParse({ ...SIGNALS, gpu: 'x'.repeat(201) }).success).toBe(
      false,
    );
    expect(
      hardwareSignalsSchema.safeParse({ ...SIGNALS, screen: { long: 20001, short: 1 } }).success,
    ).toBe(false);
  });
});

describe('same device (F01B rule 6)', () => {
  const session: SessionKeys = {
    browserKey: 'b1',
    hardwareKey: 'h1',
    ipAddress: '185.12.34.56',
    lastIpAddress: '185.12.34.57',
  };
  const other = { browserKey: 'b2', hardwareKey: 'h2', ipAddress: '10.0.0.1', lastIpAddress: null };

  it('is the same browser with the same browser key, whatever the address', () => {
    expect(deviceMatch(session, { ...other, browserKey: 'b1' })).toBe('same_browser');
    expect(deviceMatch(session, { ...other, browserKey: 'b1', hardwareKey: 'h1' })).toBe(
      'same_browser',
    );
  });

  it('is probably the same device with the same hardware key and a shared address', () => {
    expect(deviceMatch(session, { ...other, hardwareKey: 'h1', ipAddress: '185.12.34.56' })).toBe(
      'same_device',
    );
    expect(
      deviceMatch(session, { ...other, hardwareKey: 'h1', lastIpAddress: '185.12.34.57' }),
    ).toBe('same_device');
  });

  it('keeps machines in different places apart', () => {
    expect(deviceMatch(session, { ...other, hardwareKey: 'h1' })).toBeNull();
    expect(deviceMatch(session, { ...other, ipAddress: '185.12.34.56' })).toBeNull();
  });

  it('never matches on missing keys', () => {
    const empty = { browserKey: null, hardwareKey: null, ipAddress: null, lastIpAddress: null };
    expect(deviceMatch(empty, empty)).toBeNull();
    expect(
      deviceMatch({ ...empty, ipAddress: '1.1.1.1' }, { ...empty, ipAddress: '1.1.1.1' }),
    ).toBeNull();
  });
});
