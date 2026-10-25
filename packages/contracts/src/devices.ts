import { z } from 'zod';
import { departmentCodeSchema } from './departments.js';
import { personSchema } from './images.js';
import { devicePushSchema } from './push.js';

/*
 * F14 email rule 15: a device is the browser family and the operating system family read from
 * the user agent. Versions are left out, so a browser update is not a new device.
 */

/** First match wins: Edge and Opera also say "Chrome", Chrome also says "Safari". */
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

/** First match wins: Android also says "Linux", iOS also says "Mac OS X". */
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\bWindows\b/, 'Windows'],
  [/\biPhone|\biPad|\biPod/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

export const UNKNOWN_BROWSER = 'Unknown browser';

export const UNKNOWN_SYSTEM = 'Unknown system';

export interface Device {
  browser: string;
  system: string;
  /** As the new-device email shows it, e.g. "Chrome · Windows". */
  label: string;
}

/** The device a user agent stands for; an empty or unknown one is "Unknown browser · Unknown system". */
export function deviceOf(userAgent: string | null | undefined): Device {
  const find = (families: typeof BROWSERS) =>
    families.find(([pattern]) => pattern.test(userAgent ?? ''))?.[1];
  const browser = find(BROWSERS) ?? UNKNOWN_BROWSER;
  const system = find(SYSTEMS) ?? UNKNOWN_SYSTEM;
  return { browser, system, label: `${browser} · ${system}` };
}

/*
 * F01B: signed-in devices. A session is matched to another user's session by its browser key
 * (the `vh_device` cookie) or by its hardware key and IP address (rule 6).
 */

/** Rule 4 and 16: last activity is written, and shown as "Active now", within this window. */
export const ACTIVITY_WINDOW_MS = 5 * 60 * 1000;

/** Rule 5: fewer known signals than this give no hardware key. */
export const MIN_HARDWARE_SIGNALS = 3;

/** What the web app reports; the system family comes from the session's user agent. */
export const hardwareSignalsSchema = z
  .object({
    cores: z.number().int().min(1).max(512).nullable(),
    timeZone: z.string().trim().min(1).max(64).nullable(),
    screen: z
      .object({
        long: z.number().int().min(1).max(20000),
        short: z.number().int().min(1).max(20000),
      })
      .nullable(),
    gpu: z.string().max(200).nullable(),
  })
  .meta({ id: 'HardwareSignals' });

export type HardwareSignals = z.infer<typeof hardwareSignalsSchema>;

/**
 * Rule 5: the GPU model as every browser on the machine names it. Chrome and Edge wrap it in
 * ANGLE with the vendor, PCI ids and the Direct3D or OpenGL backend; Firefox adds ", or similar".
 */
export function normalizeGpu(raw: string | null): string | null {
  let gpu = (raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/,\s*or similar$/, '');
  const angle = /^angle \((.*)\)$/.exec(gpu);
  if (angle?.[1]) {
    // "vendor, renderer, backend": the renderer is the second part when there are several.
    const parts = angle[1].split(', ');
    gpu = (parts.length > 1 ? parts[1] : parts[0]) ?? '';
  }
  gpu = gpu
    .replace(/^angle metal renderer:\s*/, '')
    .replace(/\(0x[0-9a-f]+\)/g, '')
    .replace(/\b(?:direct3d|d3d)\w*.*$/, '')
    .replace(/\((?:r|tm)\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return gpu && gpu !== 'unknown' ? gpu : null;
}

/**
 * Rule 5: the normalized signals as one string for the API to key with HMAC, or null when fewer
 * than three are known. The system family is read from the user agent.
 */
export function hardwareIdentity(
  signals: HardwareSignals,
  userAgent: string | null | undefined,
): string | null {
  const system = deviceOf(userAgent).system;
  const known = [
    system === UNKNOWN_SYSTEM ? null : system.toLowerCase(),
    signals.cores === null ? null : String(signals.cores),
    signals.timeZone,
    signals.screen ? `${signals.screen.long}x${signals.screen.short}` : null,
    normalizeGpu(signals.gpu),
  ];
  if (known.filter((value) => value !== null).length < MIN_HARDWARE_SIGNALS) return null;
  return `v1|${known.map((value) => value ?? '?').join('|')}`;
}

export const DEVICE_MATCHES = ['same_browser', 'same_device'] as const;

export const deviceMatchSchema = z.enum(DEVICE_MATCHES).meta({ id: 'DeviceMatch' });

export type DeviceMatch = z.infer<typeof deviceMatchSchema>;

/** The keys and addresses of a session that rule 6 compares. */
export interface SessionKeys {
  browserKey: string | null;
  hardwareKey: string | null;
  ipAddress: string | null;
  lastIpAddress: string | null;
}

/** Rule 6: how `other` shares a device with `session`, or null when it does not. */
export function deviceMatch(session: SessionKeys, other: SessionKeys): DeviceMatch | null {
  if (session.browserKey && session.browserKey === other.browserKey) return 'same_browser';
  if (!session.hardwareKey || session.hardwareKey !== other.hardwareKey) return null;
  const addresses = [session.ipAddress, session.lastIpAddress].filter(Boolean);
  const shared = [other.ipAddress, other.lastIpAddress].some((ip) => ip && addresses.includes(ip));
  return shared ? 'same_device' : null;
}

/** Rule 7: a country and city, the local network, or null when unknown. */
export const ipLocationSchema = z
  .union([
    z.object({ countryCode: z.string().length(2), city: z.string().nullable() }),
    z.object({ local: z.literal(true) }),
  ])
  .nullable()
  .meta({ id: 'IpLocation' });

export type IpLocation = z.infer<typeof ipLocationSchema>;

const devicePlaceSchema = z.object({
  at: z.iso.datetime(),
  ip: z.string().nullable(),
  location: ipLocationSchema,
});

/** Rule 15: another user signed in on the device of a session. */
export const sharedDeviceUserSchema = z
  .object({
    user: personSchema,
    department: z.object({ code: departmentCodeSchema, name: z.string() }).nullable(),
    match: deviceMatchSchema,
    lastActiveAt: z.iso.datetime(),
  })
  .meta({ id: 'SharedDeviceUser' });

export type SharedDeviceUser = z.infer<typeof sharedDeviceUserSchema>;

export const signedInDeviceSchema = z
  .object({
    id: z.uuid(),
    current: z.boolean(),
    device: z.object({ browser: z.string(), system: z.string(), label: z.string() }),
    signIn: devicePlaceSchema,
    lastActive: devicePlaceSchema,
    sharedWith: z.array(sharedDeviceUserSchema),
    /** F16 rule A12. */
    push: devicePushSchema,
  })
  .meta({ id: 'SignedInDevice' });

export type SignedInDevice = z.infer<typeof signedInDeviceSchema>;

/** Rule 14: the current session first, then by last activity, newest first. */
export const signedInDeviceListSchema = z
  .object({ items: z.array(signedInDeviceSchema) })
  .meta({ id: 'SignedInDeviceList' });

export type SignedInDeviceList = z.infer<typeof signedInDeviceListSchema>;

export const signOutAllDevicesSchema = z
  .object({ includeCurrent: z.boolean() })
  .meta({ id: 'SignOutAllDevices' });

export type SignOutAllDevices = z.infer<typeof signOutAllDevicesSchema>;

export const signOutAllDevicesResponseSchema = z
  .object({ signedOut: z.number().int().min(0) })
  .meta({ id: 'SignOutAllDevicesResponse' });

export type SignOutAllDevicesResponse = z.infer<typeof signOutAllDevicesResponseSchema>;
