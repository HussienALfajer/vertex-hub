import { Injectable } from '@nestjs/common';

/** Deletes what a module keeps for a while and returns how many it removed. */
export type FilePurge = (now: Date) => Promise<number>;

/**
 * Temporary objects other modules store outside file items (F13 statement PDFs), deleted by the
 * daily `files.purge-uploads` run alongside unattached uploads. Each module registers its purge.
 */
@Injectable()
export class FilePurges {
  private readonly purges = new Map<string, FilePurge>();

  register(name: string, purge: FilePurge): void {
    this.purges.set(name, purge);
  }

  async run(now = new Date()): Promise<Map<string, number>> {
    const purged = new Map<string, number>();
    for (const [name, purge] of this.purges) purged.set(name, await purge(now));
    return purged;
  }
}
