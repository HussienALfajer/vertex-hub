import { Inject, Injectable } from '@nestjs/common';
import type { Role } from '@vertex-hub/contracts';
import { type Database, userRoles } from '@vertex-hub/db';
import { asc, eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';

@Injectable()
export class RolesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async rolesOf(userId: string): Promise<Role[]> {
    const rows = await this.db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, userId))
      .orderBy(asc(userRoles.role));
    return rows.map((row) => row.role);
  }
}
