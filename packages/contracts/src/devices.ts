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
