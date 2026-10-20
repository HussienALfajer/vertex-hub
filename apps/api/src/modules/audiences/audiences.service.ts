import { Inject, Injectable } from '@nestjs/common';
import { AUDIENCE_PREVIEW_MAX, type Audience, type AudiencePreview } from '@vertex-hub/contracts';
import type { Database } from '@vertex-hub/db';
import { DATABASE } from '../../core/database/database.module.js';
import { UserDirectory } from '../auth/index.js';
import { AudienceResolver } from './audience-resolver.js';

@Injectable()
export class AudiencesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly resolver: AudienceResolver,
    private readonly users: UserDirectory,
  ) {}

  /** Rule D2: the live count and the first 500 names, by name. */
  async preview(audience: Audience): Promise<AudiencePreview> {
    const ids = await this.resolver.resolve(this.db, audience);
    const members = await this.users.audienceMembers(ids);
    return { count: ids.length, users: members.slice(0, AUDIENCE_PREVIEW_MAX) };
  }
}
