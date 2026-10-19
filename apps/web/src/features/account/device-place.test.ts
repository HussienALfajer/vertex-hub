import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { isIpLocation, placeText } from './device-place';

const t = i18n.t.bind(i18n);

describe('placeText', () => {
  it('names the country in Arabic and keeps the city as DB-IP spells it', () => {
    expect(placeText(t, { countryCode: 'SY', city: 'Damascus' })).toBe('Damascus، سوريا');
    expect(placeText(t, { countryCode: 'de', city: null })).toBe('ألمانيا');
  });

  it('shows private addresses as the local network and missing ones as unknown', () => {
    expect(placeText(t, { local: true })).toBe(i18n.t('devices.localNetwork'));
    expect(placeText(t, null)).toBe(i18n.t('devices.unknownPlace'));
  });
});

describe('isIpLocation', () => {
  it('accepts what the API records and nothing else', () => {
    expect(isIpLocation({ countryCode: 'SY', city: null })).toBe(true);
    expect(isIpLocation({ local: true })).toBe(true);
    expect(isIpLocation('Damascus office')).toBe(false);
    expect(isIpLocation({ name: 'Studio' })).toBe(false);
  });
});
