import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  annexSnapshotSchema,
  CONTRACTS_PDF_JOB,
  CONTRACTS_PDF_READY_JOB,
  type ContractPdfJob,
  type ContractPdfReadyJob,
  contractPdfReadyJobSchema,
  contractSnapshotSchema,
  type QuotePdfRender,
} from '@vertex-hub/contracts';
import {
  type Database,
  retainerContractAnnexes,
  retainerContracts,
  retainers,
  type Transaction,
} from '@vertex-hub/db';
import { and, eq, ne } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { JobQueue } from '../../core/jobs/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { GeneratedFiles } from '../files/index.js';
import {
  type AnnexRow,
  annexOf,
  type ContractRow,
  canManageContracts,
  contractOf,
  contractRetainer,
} from './contract-access.js';
import { ContractContent, contractPdfHash } from './contract-content.js';

const PDF_MIME_TYPE = 'application/pdf';

/** The stored name of an issued contract's PDF, and of an annex's. */
export const contractPdfName = (number: string) => `${number}.pdf`;
export const annexPdfName = (number: string, annex: number) => `${number} - annex ${annex}.pdf`;

// PDF state is not an edit: every update keeps `updated_at`.

/**
 * Contract and annex PDFs (spec F05C K4, K10), as F13's invoice PDFs: queues renders for the
 * worker (`contracts.pdf`), takes their results (`contracts.pdf-ready`), and serves the PDF of an
 * issued contract, a draft preview and an annex. Issued PDFs become documents of the contract.
 */
@Injectable()
export class ContractPdfs implements OnModuleInit {
  private readonly logger = new Logger(ContractPdfs.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly content: ContractContent,
    private readonly files: GeneratedFiles,
    private readonly jobs: JobQueue,
  ) {}

  onModuleInit(): void {
    this.jobs.work(CONTRACTS_PDF_READY_JOB.queue, (data) =>
      this.ready(contractPdfReadyJobSchema.parse(data)),
    );
  }

  /**
   * "Preview PDF" on a draft (managers), or "Render again" on an issued contract whose PDF is not
   * ready (any reader). A preview of an unchanged draft is not rendered twice.
   */
  async render(
    actor: CurrentUserInfo,
    retainerId: string,
    contractId: string,
  ): Promise<QuotePdfRender> {
    const { state, job } = await this.db.transaction(async (tx) => {
      const retainer = await contractRetainer(tx, this.clients, actor, retainerId);
      const row = await contractOf(tx, retainerId, contractId, { forUpdate: true });
      if (row.status === 'draft') {
        if (!canManageContracts(actor, retainer)) throw new ForbiddenException();
        if (row.archivedAt) {
          throw new CodedException(409, 'INVALID_TRANSITION', 'A discarded draft is not previewed');
        }
        const snapshot = await this.content.live(tx, retainer, row);
        const hash = contractPdfHash('contract_draft', snapshot);
        if (row.draftPdfStatus === 'ready' && row.draftPdfHash === hash) {
          return { state: 'ready' as const, job: null };
        }
        // The previous preview stays until the new one replaces it.
        await tx
          .update(retainerContracts)
          .set({ draftPdfStatus: 'pending', draftPdfRequestedHash: hash, updatedAt: row.updatedAt })
          .where(eq(retainerContracts.id, row.id));
        const job: ContractPdfJob = { kind: 'contract_draft', id: row.id, hash, snapshot };
        return { state: 'pending' as const, job };
      }
      if (row.pdfStatus === 'ready') return { state: 'ready' as const, job: null };
      await tx
        .update(retainerContracts)
        .set({ pdfStatus: 'pending', updatedAt: row.updatedAt })
        .where(eq(retainerContracts.id, row.id));
      return { state: 'pending' as const, job: contractJob(row) };
    });
    if (job) await this.queue(job);
    return { state };
  }

  /** "Render again" on an annex whose PDF is not ready (any reader). */
  async renderAnnex(
    actor: CurrentUserInfo,
    retainerId: string,
    contractId: string,
    annexId: string,
  ): Promise<QuotePdfRender> {
    const { state, job } = await this.db.transaction(async (tx) => {
      await contractRetainer(tx, this.clients, actor, retainerId);
      await contractOf(tx, retainerId, contractId);
      const annex = await annexOf(tx, contractId, annexId, { forUpdate: true });
      if (annex.pdfStatus === 'ready') return { state: 'ready' as const, job: null };
      await tx
        .update(retainerContractAnnexes)
        .set({ pdfStatus: 'pending', updatedAt: annex.updatedAt })
        .where(eq(retainerContractAnnexes.id, annex.id));
      return { state: 'pending' as const, job: annexJob(annex) };
    });
    if (job) await this.queue(job);
    return { state };
  }

  /** K4: queues the PDF of a contract just issued, once committed. */
  queueIssued(row: ContractRow): Promise<void> {
    return this.queue(contractJob(row));
  }

  /** K10: queues the PDF of an annex just issued, once committed. */
  queueAnnex(annex: AnnexRow): Promise<void> {
    return this.queue(annexJob(annex));
  }

  /** Deletes the preview object of a draft that was just issued or discarded. */
  async discardPreview(objectKey: string | null): Promise<void> {
    if (objectKey) await this.removeObject(objectKey);
  }

  /**
   * F05C "Jobs": contract and annex PDFs whose render never came back are queued again by the
   * `invoices.daily` run.
   */
  async requeuePending(): Promise<number> {
    const contracts = await this.db
      .select()
      .from(retainerContracts)
      .where(
        and(eq(retainerContracts.pdfStatus, 'pending'), ne(retainerContracts.status, 'draft')),
      );
    for (const row of contracts) await this.queueIssued(row);
    const annexes = await this.db
      .select()
      .from(retainerContractAnnexes)
      .where(eq(retainerContractAnnexes.pdfStatus, 'pending'));
    for (const annex of annexes) await this.queueAnnex(annex);
    return contracts.length + annexes.length;
  }

  /**
   * `contracts.pdf-ready`: attaches an issued contract's or an annex's PDF once as a document of
   * the contract, keeps the latest asked-for draft preview, or records a failure. Results nobody
   * waits for any more are deleted. Safe to run twice.
   */
  async ready(result: ContractPdfReadyJob): Promise<void> {
    const removals: string[] = [];
    await this.db.transaction(async (tx) => {
      switch (result.kind) {
        case 'contract_draft':
          return this.previewReady(tx, result, removals);
        case 'contract':
          return this.contractReady(tx, result, removals);
        case 'annex':
          return this.annexReady(tx, result, removals);
      }
    });
    for (const key of removals) await this.removeObject(key);
  }

  /** The PDF of an issued contract, or the draft preview with `draft` (managers); 404 until ready. */
  async serve(
    actor: CurrentUserInfo,
    retainerId: string,
    contractId: string,
    draft: boolean,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const retainer = await contractRetainer(this.db, this.clients, actor, retainerId);
    const row = await contractOf(this.db, retainerId, contractId);
    if (draft) {
      if (!canManageContracts(actor, retainer)) throw new ForbiddenException();
      if (row.status !== 'draft' || row.draftPdfStatus !== 'ready' || !row.draftPdfObjectKey) {
        throw new NotFoundException();
      }
      const name = `${retainer.client.name} - DRAFT.pdf`;
      await this.files.serve(row.draftPdfObjectKey, name, PDF_MIME_TYPE, request, response);
      return;
    }
    const file = row.pdfFileItemId ? await this.files.latest(row.pdfFileItemId) : null;
    if (!file || !row.number) throw new NotFoundException();
    const name = `${retainer.client.name} - ${row.number}.pdf`;
    await this.files.serve(file.storageKey, name, file.mimeType, request, response);
  }

  /** An annex's PDF; 404 until it exists. */
  async serveAnnex(
    actor: CurrentUserInfo,
    retainerId: string,
    contractId: string,
    annexId: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const retainer = await contractRetainer(this.db, this.clients, actor, retainerId);
    const row = await contractOf(this.db, retainerId, contractId);
    const annex = await annexOf(this.db, contractId, annexId);
    const file = annex.pdfFileItemId ? await this.files.latest(annex.pdfFileItemId) : null;
    if (!file || !row.number) throw new NotFoundException();
    const name = `${retainer.client.name} - ${row.number} - annex ${annex.annexNumber}.pdf`;
    await this.files.serve(file.storageKey, name, file.mimeType, request, response);
  }

  private async previewReady(
    tx: Transaction,
    result: ContractPdfReadyJob,
    removals: string[],
  ): Promise<void> {
    const key = result.file?.storageKey ?? null;
    const [row] = await tx
      .select()
      .from(retainerContracts)
      .where(eq(retainerContracts.id, result.id))
      .for('update');
    const awaited =
      row?.status === 'draft' && !row.archivedAt && row.draftPdfRequestedHash === result.hash;
    if (!row || !awaited) {
      if (key && key !== row?.draftPdfObjectKey) removals.push(key);
      return;
    }
    if (!result.file) {
      await tx
        .update(retainerContracts)
        .set({ draftPdfStatus: 'failed', updatedAt: row.updatedAt })
        .where(eq(retainerContracts.id, row.id));
      return;
    }
    if (row.draftPdfObjectKey && row.draftPdfObjectKey !== result.file.storageKey) {
      removals.push(row.draftPdfObjectKey);
    }
    await tx
      .update(retainerContracts)
      .set({
        draftPdfStatus: 'ready',
        draftPdfObjectKey: result.file.storageKey,
        draftPdfAt: new Date(),
        draftPdfHash: result.hash,
        updatedAt: row.updatedAt,
      })
      .where(eq(retainerContracts.id, row.id));
  }

  private async contractReady(
    tx: Transaction,
    result: ContractPdfReadyJob,
    removals: string[],
  ): Promise<void> {
    const [row] = await tx
      .select()
      .from(retainerContracts)
      .where(eq(retainerContracts.id, result.id))
      .for('update');
    const current =
      row?.snapshot && row.status !== 'draft'
        ? contractPdfHash('contract', contractSnapshotSchema.parse(row.snapshot))
        : null;
    if (!row || current !== result.hash) {
      await this.dropUnheld(tx, result, removals);
      return;
    }
    // Attached once: the snapshot never changes after the issue.
    if (row.pdfFileItemId) return;
    if (!result.file) {
      await tx
        .update(retainerContracts)
        .set({ pdfStatus: 'failed', updatedAt: row.updatedAt })
        .where(eq(retainerContracts.id, row.id));
      return;
    }
    const clientId = await this.clientOf(tx, row.retainerId);
    const pdfFileItemId = await this.files.attachDocument(tx, {
      ...result.file,
      mimeType: PDF_MIME_TYPE,
      ownerType: 'retainer_contract',
      ownerId: row.id,
      clientId,
      name: contractPdfName(row.number ?? ''),
      createdById: row.issuedById ?? row.createdById,
    });
    await tx
      .update(retainerContracts)
      .set({ pdfStatus: 'ready', pdfFileItemId, updatedAt: row.updatedAt })
      .where(eq(retainerContracts.id, row.id));
  }

  private async annexReady(
    tx: Transaction,
    result: ContractPdfReadyJob,
    removals: string[],
  ): Promise<void> {
    const [annex] = await tx
      .select()
      .from(retainerContractAnnexes)
      .where(eq(retainerContractAnnexes.id, result.id))
      .for('update');
    const current = annex
      ? contractPdfHash('annex', annexSnapshotSchema.parse(annex.snapshot))
      : null;
    if (!annex || current !== result.hash) {
      await this.dropUnheld(tx, result, removals);
      return;
    }
    if (annex.pdfFileItemId) return;
    if (!result.file) {
      await tx
        .update(retainerContractAnnexes)
        .set({ pdfStatus: 'failed', updatedAt: annex.updatedAt })
        .where(eq(retainerContractAnnexes.id, annex.id));
      return;
    }
    const [contract] = await tx
      .select({ retainerId: retainerContracts.retainerId, number: retainerContracts.number })
      .from(retainerContracts)
      .where(eq(retainerContracts.id, annex.contractId));
    if (!contract) throw new Error('The contract of the annex was not found');
    const pdfFileItemId = await this.files.attachDocument(tx, {
      ...result.file,
      mimeType: PDF_MIME_TYPE,
      ownerType: 'retainer_contract',
      ownerId: annex.contractId,
      clientId: await this.clientOf(tx, contract.retainerId),
      name: annexPdfName(contract.number ?? '', annex.annexNumber),
      createdById: annex.issuedById,
    });
    await tx
      .update(retainerContractAnnexes)
      .set({ pdfStatus: 'ready', pdfFileItemId, updatedAt: annex.updatedAt })
      .where(eq(retainerContractAnnexes.id, annex.id));
  }

  /** Deletes a result's object unless a document version already holds it. */
  private async dropUnheld(
    tx: Transaction,
    result: ContractPdfReadyJob,
    removals: string[],
  ): Promise<void> {
    const key = result.file?.storageKey;
    if (key && !(await this.files.holdsObject(tx, key))) removals.push(key);
  }

  private async clientOf(tx: Transaction, retainerId: string): Promise<string> {
    const [retainer] = await tx
      .select({ clientId: retainers.clientId })
      .from(retainers)
      .where(eq(retainers.id, retainerId));
    if (!retainer) throw new Error('The retainer of the contract was not found');
    return retainer.clientId;
  }

  private async queue(job: ContractPdfJob): Promise<void> {
    await this.jobs.send(CONTRACTS_PDF_JOB.queue, job, {
      retryLimit: CONTRACTS_PDF_JOB.retryLimit,
    });
  }

  private async removeObject(key: string): Promise<void> {
    try {
      await this.files.remove(key);
    } catch (error) {
      this.logger.warn(`Could not delete ${key}: ${String(error)}`);
    }
  }
}

/** The render of an issued contract: its frozen snapshot. */
function contractJob(row: ContractRow): ContractPdfJob {
  const snapshot = contractSnapshotSchema.parse(row.snapshot);
  return { kind: 'contract', id: row.id, hash: contractPdfHash('contract', snapshot), snapshot };
}

/** The render of an annex: its frozen snapshot. */
function annexJob(annex: AnnexRow): ContractPdfJob {
  const snapshot = annexSnapshotSchema.parse(annex.snapshot);
  return { kind: 'annex', id: annex.id, hash: contractPdfHash('annex', snapshot), snapshot };
}
