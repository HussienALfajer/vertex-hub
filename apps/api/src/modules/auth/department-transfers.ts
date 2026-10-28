import { Injectable } from '@nestjs/common';
import type {
  DepartmentCode,
  DepartmentTransferCategory,
  DepartmentTransferItem,
} from '@vertex-hub/contracts';
import type { Transaction } from '@vertex-hub/db';
import type { AuditActor } from '../audit/index.js';

/** The records of one category an archive would move: how many, and the first five by name. */
export interface TransferPreview {
  count: number;
  items: DepartmentTransferItem[];
}

/** Work categories other modules own; `auth` moves the members itself. */
export type WorkTransferCategory = Exclude<DepartmentTransferCategory, 'members'>;

/**
 * One module's share of a category (F23 rule 8). `move` runs inside the archive's transaction,
 * after the members moved, writes the module's own audit entries with the reason
 * `department_archived`, and returns how many records it moved.
 */
export interface DepartmentTransfer {
  category: WorkTransferCategory;
  preview(tx: Transaction, code: DepartmentCode): Promise<TransferPreview>;
  move(
    tx: Transaction,
    from: DepartmentCode,
    to: DepartmentCode,
    actor: AuditActor,
  ): Promise<number>;
}

const PREVIEW_ITEMS = 5;

/**
 * Lets the modules that hold a department's open work (tasks, questions, services, quotes,
 * templates, projects and retainers) move it when the department is archived (F23 rule 10),
 * without `auth` importing them.
 */
@Injectable()
export class DepartmentTransfers {
  private readonly transfers: DepartmentTransfer[] = [];

  register(transfer: DepartmentTransfer): void {
    this.transfers.push(transfer);
  }

  /** The category's records across the modules that registered it. */
  async preview(
    tx: Transaction,
    category: WorkTransferCategory,
    code: DepartmentCode,
  ): Promise<TransferPreview> {
    let count = 0;
    const items: DepartmentTransferItem[] = [];
    // One query at a time: a transaction runs on a single connection.
    for (const transfer of this.of(category)) {
      const part = await transfer.preview(tx, code);
      count += part.count;
      items.push(...part.items);
    }
    return { count, items: items.slice(0, PREVIEW_ITEMS) };
  }

  async move(
    tx: Transaction,
    category: WorkTransferCategory,
    from: DepartmentCode,
    to: DepartmentCode,
    actor: AuditActor,
  ): Promise<number> {
    let moved = 0;
    for (const transfer of this.of(category)) moved += await transfer.move(tx, from, to, actor);
    return moved;
  }

  private of(category: WorkTransferCategory): DepartmentTransfer[] {
    return this.transfers.filter((transfer) => transfer.category === category);
  }
}
