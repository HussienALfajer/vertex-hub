import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IpLocations } from '../src/modules/auth/ip-locations.js';
import { mmdbFixture } from './mmdb-fixture.js';

const DAMASCUS = { country: { iso_code: 'SY' }, city: { names: { en: 'Damascus' } } };
const BERLIN = { country: { iso_code: 'DE' }, city: { names: { en: 'Berlin' } } };

describe('IP locations (F01B rule 7)', () => {
  let dir: string;
  let path: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'geoip-'));
    path = join(dir, 'dbip-city-lite.mmdb');
    await writeFile(
      path,
      mmdbFixture([
        ['185.12.34.0/24', DAMASCUS],
        ['2a02:2f0c::/32', BERLIN],
        ['203.0.113.0/24', { country: { iso_code: 'AU' } }],
      ]),
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const loaded = async (file = path) => {
    const locations = new IpLocations({ GEOIP_DB_PATH: file });
    await locations.reload();
    return locations;
  };

  it('finds the country and city of IPv4 and IPv6 addresses', async () => {
    const locations = await loaded();
    expect(locations.lookup('185.12.34.56')).toEqual({ countryCode: 'SY', city: 'Damascus' });
    expect(locations.lookup('::ffff:185.12.34.56')).toEqual({
      countryCode: 'SY',
      city: 'Damascus',
    });
    expect(locations.lookup('2a02:2f0c:1:2::5')).toEqual({ countryCode: 'DE', city: 'Berlin' });
    expect(locations.lookup('203.0.113.9')).toEqual({ countryCode: 'AU', city: null });
  });

  it('names private, loopback and link-local addresses the local network', async () => {
    const locations = await loaded();
    for (const ip of ['10.1.2.3', '172.20.0.1', '192.168.1.10', '127.0.0.1', '169.254.1.1']) {
      expect(locations.lookup(ip)).toEqual({ local: true });
    }
    for (const ip of ['::1', 'fd12:3456::1', 'fe80::1']) {
      expect(locations.lookup(ip)).toEqual({ local: true });
    }
  });

  it('gives no location for unknown or malformed addresses', async () => {
    const locations = await loaded();
    expect(locations.lookup('8.8.8.8')).toBeNull();
    expect(locations.lookup('not an ip')).toBeNull();
    expect(locations.lookup(null)).toBeNull();
  });

  it('works without the file: no location, local addresses still known (edge case 10)', async () => {
    const missing = await loaded(join(dir, 'missing.mmdb'));
    expect(missing.lookup('185.12.34.56')).toBeNull();
    expect(missing.lookup('127.0.0.1')).toEqual({ local: true });
    const unset = new IpLocations({});
    await unset.reload();
    expect(unset.lookup('185.12.34.56')).toBeNull();
  });

  it('keeps the loaded database when a newer file is corrupt, and reloads a good one', async () => {
    const changing = join(dir, 'changing.mmdb');
    await writeFile(changing, mmdbFixture([['185.12.34.0/24', DAMASCUS]]));
    const locations = await loaded(changing);
    expect(locations.lookup('185.12.34.56')).toEqual({ countryCode: 'SY', city: 'Damascus' });

    await writeFile(changing, 'not a database');
    await utimes(changing, new Date(), new Date(Date.now() + 1_000));
    await locations.reload();
    expect(locations.lookup('185.12.34.56')).toEqual({ countryCode: 'SY', city: 'Damascus' });

    await writeFile(changing, mmdbFixture([['185.12.34.0/24', BERLIN]]));
    await utimes(changing, new Date(), new Date(Date.now() + 2_000));
    await locations.reload();
    expect(locations.lookup('185.12.34.56')).toEqual({ countryCode: 'DE', city: 'Berlin' });
  });
});
