import { Inject, Injectable } from '@nestjs/common';
import type { HealthResponse } from '@vertex-hub/contracts';
import { type Database, pingDatabase } from '@vertex-hub/db';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class HealthService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async check(): Promise<HealthResponse> {
    const databaseUp = await pingDatabase(this.db);
    return {
      status: databaseUp ? 'ok' : 'error',
      checks: { database: databaseUp ? 'up' : 'down' },
      timestamp: new Date().toISOString(),
    };
  }
}
