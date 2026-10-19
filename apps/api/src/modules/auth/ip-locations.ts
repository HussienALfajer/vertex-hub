import { readFile, stat } from 'node:fs/promises';
import { BlockList, isIP } from 'node:net';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { IpLocation } from '@vertex-hub/contracts';
import { type CityResponse, Reader } from 'mmdb-lib';
import { ENV, type Env } from '../../core/config/env.js';

/** F01B rule 7: how often the file is checked for a newer copy. */
export const GEOIP_RELOAD_MS = 60 * 60 * 1000;

/** Private, loopback and link-local ranges: "Local network" (rule 7). */
const LOCAL = new BlockList();
for (const [network, prefix] of [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
] as const) {
  LOCAL.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  LOCAL.addSubnet(network, prefix, 'ipv6');
}

/**
 * F01B rule 7 (ADR 0032): sign-in addresses located with the DB-IP City Lite database at
 * `GEOIP_DB_PATH`, read into memory and reloaded when the file changes. No address leaves the
 * server. Without the file, or for an address it does not know, the location is null.
 */
@Injectable()
export class IpLocations implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IpLocations.name);
  private readonly path: string | null;
  private reader: Reader<CityResponse> | null = null;
  private loadedAt: number | null = null;
  private lastError: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(@Inject(ENV) env: Pick<Env, 'GEOIP_DB_PATH'>) {
    this.path = env.GEOIP_DB_PATH ?? null;
  }

  async onModuleInit(): Promise<void> {
    if (!this.path) return;
    await this.reload();
    this.timer = setInterval(() => void this.reload(), GEOIP_RELOAD_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Reads the file when it changed since the last load. A failed read keeps the database already
   * loaded and logs the error once (edge case 10).
   */
  async reload(): Promise<void> {
    if (!this.path) return;
    try {
      const { mtimeMs } = await stat(this.path);
      if (mtimeMs === this.loadedAt) return;
      this.reader = new Reader<CityResponse>(await readFile(this.path));
      this.loadedAt = mtimeMs;
      this.lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== this.lastError) {
        this.logger.error(`Could not load the GeoIP database at ${this.path}: ${message}`);
      }
      this.lastError = message;
    }
  }

  lookup(address: string | null): IpLocation {
    const ip = address?.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '') ?? '';
    const version = isIP(ip);
    if (version === 0) return null;
    if (LOCAL.check(ip, version === 4 ? 'ipv4' : 'ipv6')) return { local: true };
    if (!this.reader) return null;
    try {
      const found = this.reader.get(ip);
      const countryCode = found?.country?.iso_code;
      if (!countryCode) return null;
      return { countryCode, city: found.city?.names.en ?? null };
    } catch {
      return null;
    }
  }
}
