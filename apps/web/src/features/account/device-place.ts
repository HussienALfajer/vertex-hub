import type { IpLocation } from '@vertex-hub/contracts';
import type { TFunction } from 'i18next';

/** Rule 8: the country in Arabic; an unknown code shows as it is. */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['ar'], { type: 'region' }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/**
 * Where an address is (F01B rules 7 and 8): "City، Country" with the city as DB-IP spells it,
 * the local network, or unknown.
 */
export function placeText(t: TFunction, location: IpLocation): string {
  if (!location) return t('devices.unknownPlace');
  if ('local' in location) return t('devices.localNetwork');
  const country = countryName(location.countryCode);
  return location.city ? `${location.city}، ${country}` : country;
}

/** Whether an audit value is a location the API recorded (`user.session_signed_out`). */
export function isIpLocation(value: unknown): value is NonNullable<IpLocation> {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return item.local === true || typeof item.countryCode === 'string';
}
