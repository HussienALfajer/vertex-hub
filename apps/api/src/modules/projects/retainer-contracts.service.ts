import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  CONTRACT_LIMITS,
  type ContractAnnex,
  type ContractSnapshot,
  type CreateContract,
  contractSnapshotSchema,
  currentCycleNumber,
  formatContractNumber,
  type RetainerContract,
  type RetainerContractDetail,
  type RetainerContractList,
  type SignedContract,
  type UpdateContract,
  unknownPlaceholders,
  type VoidContract,
} from '@vertex-hub/contracts';
import {
  type Database,
  retainerAmendments,
  retainerContractAnnexes,
  retainerContractArticles,
  retainerContracts,
  retainerTerms,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { GeneratedFiles } from '../files/index.js';
import {
  type AnnexRow,
  type ContractRow,
  canManageContracts,
  contractOf,
  contractRetainer,
} from './contract-access.js';
import {
  absentBlocks,
  ContractContent,
  contentFor,
  contractPdfHash,
  missingFields,
} from './contract-content.js';
import { ContractSettingsService } from './contract-settings.service.js';
import { ContractSources } from './contract-sources.js';
import { actorOf } from './project-access.js';
import {
  assertRetainerNotArchived,
  assertRetainerWritable,
  type RetainerAccess,
} from './retainer-access.js';
import { ContractPdfs } from './retainer-contract-pdfs.js';
import { RetainerTermsService } from './retainer-terms.service.js';

type Executor = Database | Transaction;

/** The statuses of a contract that holds a number and covers its cycles. */
const LIVE_ISSUED = ['issued', 'signed'] as const;

/** A contract as coverage sees it (K9, K10): the cycles it covers. */
export interface CoveringContract {
  id: string;
  kind: ContractRow['kind'];
  startCycle: number;
  /** `term` contracts: the term's last cycle; open-ended ones cover onward. */
  endCycle: number | null;
}

/**
 * The issued or signed contract that covers `cycle`: a term contract whose term holds it, else
 * the open-ended contract that starts latest at or before it.
 */
export function coveringContract(
  contracts: readonly CoveringContract[],
  cycle: number,
): CoveringContract | null {
  const term = contracts.find(
    (contract) =>
      contract.kind === 'term' &&
      contract.startCycle <= cycle &&
      contract.endCycle !== null &&
      cycle <= contract.endCycle,
  );
  if (term) return term;
  const open = contracts
    .filter((contract) => contract.kind === 'open_ended' && contract.startCycle <= cycle)
    .sort((a, b) => b.startCycle - a.startCycle);
  return open[0] ?? null;
}

/**
 * Retainer contracts (spec F05C K1–K9, K12): drafts prepared from the template, edited, issued
 * with the year's number and a frozen snapshot, voided, discarded, and their signed copies. Every
 * change holds the retainer row lock (G2) and writes its audit entry in the same transaction (G1).
 */
@Injectable()
export class RetainerContractsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly users: UserDirectory,
    private readonly settings: ContractSettingsService,
    private readonly terms: RetainerTermsService,
    private readonly content: ContractContent,
    private readonly sources: ContractSources,
    private readonly pdfs: ContractPdfs,
    private readonly files: GeneratedFiles,
  ) {}

  /** The retainer's contracts, newest first, with their annexes; discarded drafts left out. */
  async list(actor: CurrentUserInfo, retainerId: string): Promise<RetainerContractList> {
    await contractRetainer(this.db, this.clients, actor, retainerId);
    const rows = await this.db
      .select()
      .from(retainerContracts)
      .where(
        and(eq(retainerContracts.retainerId, retainerId), isNull(retainerContracts.archivedAt)),
      )
      .orderBy(desc(retainerContracts.createdAt), desc(retainerContracts.id));
    return { items: await this.present(this.db, retainerId, rows) };
  }

  async get(
    actor: CurrentUserInfo,
    retainerId: string,
    contractId: string,
  ): Promise<RetainerContractDetail> {
    const retainer = await contractRetainer(this.db, this.clients, actor, retainerId);
    const row = await contractOf(this.db, retainerId, contractId);
    return this.detail(this.db, actor, retainer, row);
  }

  /**
   * K1, K2: a draft for a term (scheduled or active) or for an open-ended retainer from its
   * current cycle, with the template's articles, today's date and the client's approver as the
   * signatory.
   */
  async create(
    actor: CurrentUserInfo,
    retainerId: string,
    input: CreateContract,
  ): Promise<RetainerContractDetail> {
    const contractId = await this.db.transaction(async (tx) => {
      const retainer = await contractRetainer(tx, this.clients, actor, retainerId, {
        manage: true,
        forUpdate: true,
      });
      assertRetainerWritable(retainer);
      const today = businessDate();
      let startCycle: number;
      let termId: string | null = null;
      if (input.kind === 'term') {
        const term = await this.terms.forContract(tx, retainerId, input.termId);
        if (!term) throw new NotFoundException();
        if (term.status === 'cancelled' || term.status === 'completed') {
          throw new CodedException(
            409,
            'INVALID_TRANSITION',
            'A cancelled or completed term gets no contract',
          );
        }
        startCycle = term.startCycle;
        termId = term.id;
      } else {
        startCycle = Math.max(1, currentCycleNumber(retainer.startDate, today));
        if (await this.terms.covering(tx, retainerId, startCycle)) {
          throw new CodedException(
            409,
            'INVALID_TRANSITION',
            'The current cycle is covered by a term: prepare the term contract',
          );
        }
      }
      await this.assertNoLiveContract(tx, retainerId, input.kind, termId, startCycle);
      const [approver] = await this.clients.approvers([retainer.clientId]);
      const [row] = await tx
        .insert(retainerContracts)
        .values({
          retainerId,
          kind: input.kind,
          termId,
          startCycle,
          contractDate: today,
          signatoryContactId: approver?.id ?? null,
          createdById: actor.id,
        })
        .returning();
      if (!row) throw new Error('Contract insert returned no row');
      const articles = await this.settings.articles(tx);
      if (articles.length > 0) {
        await tx.insert(retainerContractArticles).values(
          articles.map((article, index) => ({
            contractId: row.id,
            position: index + 1,
            title: article.title,
            body: article.body,
          })),
        );
      }
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'retainer_contract.created',
        entityType: 'retainer_contract',
        entityId: row.id,
        after: {
          retainerId,
          kind: row.kind,
          termId,
          startCycle,
          contractDate: row.contractDate,
          signatoryContactId: row.signatoryContactId,
        },
      });
      return row.id;
    });
    return this.get(actor, retainerId, contractId);
  }

  /** K2: a draft's date, signatory and articles (add, edit, remove, reorder any article). */
  async update(
    actor: CurrentUserInfo,
    retainerId: string,
    contractId: string,
    input: UpdateContract,
  ): Promise<RetainerContractDetail> {
    if (input.articles) assertArticles(input.articles);
    await this.db.transaction(async (tx) => {
      const { retainer, row } = await this.draftFor(tx, actor, retainerId, contractId);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const fields: Partial<ContractRow> = {};
      if (input.contractDate !== undefined && input.contractDate !== row.contractDate) {
        before.contractDate = row.contractDate;
        after.contractDate = fields.contractDate = input.contractDate;
      }
      if (
        input.signatoryContactId !== undefined &&
        input.signatoryContactId !== row.signatoryContactId
      ) {
        if (
          input.signatoryContactId &&
          !(await this.clients.isActiveContact(retainer.clientId, input.signatoryContactId, tx))
        ) {
          throw new CodedException(400, 'UNKNOWN_CONTACT', 'Pick a contact of this client');
        }
        before.signatoryContactId = row.signatoryContactId;
        after.signatoryContactId = fields.signatoryContactId = input.signatoryContactId;
      }
      if (input.articles) {
        const titles = await this.replaceArticles(tx, row.id, input.articles);
        if (titles) {
          before.articles = titles.before;
          after.articles = titles.after;
        }
      }
      if (Object.keys(after).length === 0) return;
      await tx
        .update(retainerContracts)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(retainerContracts.id, row.id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'retainer_contract.updated',
        entityType: 'retainer_contract',
        entityId: row.id,
        before,
        after: { retainerId, ...after },
      });
    });
    return this.get(actor, retainerId, contractId);
  }

  /** K8: a draft is discarded by archiving it; it holds no number. */
  async discard(
    actor: CurrentUserInfo,
    retainerId: string,
    contractId: string,
  ): Promise<RetainerContractDetail> {
    const preview = await this.db.transaction(async (tx) => {
      const { row } = await this.draftFor(tx, actor, retainerId, contractId);
      await tx
        .update(retainerContracts)
        .set({ archivedAt: new Date(), draftPdfStatus: null, draftPdfObjectKey: null })
        .where(eq(retainerContracts.id, row.id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'retainer_contract.discarded',
        entityType: 'retainer_contract',
        entityId: row.id,
        after: { retainerId, kind: row.kind, termId: row.termId },
      });
      return row.draftPdfObjectKey;
    });
    await this.pdfs.discardPreview(preview);
    return this.get(actor, retainerId, contractId);
  }

  /**
   * K4: a draft of a non-cancelled term (or of an active or paused open-ended retainer) with the
   * agency's legal name, trade name and representative and a live signatory gets the year's next
   * number; its content is frozen and its PDF queued.
   */
  async issue(
    actor: CurrentUserInfo,
    retainerId: string,
    contractId: string,
  ): Promise<RetainerContractDetail> {
    const { issued, preview } = await this.db.transaction(async (tx) => {
      const { retainer, row } = await this.draftFor(tx, actor, retainerId, contractId);
      if (row.termId) {
        const term = await this.terms.forContract(tx, retainerId, row.termId);
        if (!term || term.status === 'cancelled') {
          throw new CodedException(409, 'INVALID_TRANSITION', 'The term was cancelled');
        }
      } else if (retainer.status !== 'active' && retainer.status !== 'paused') {
        throw new CodedException(409, 'INVALID_TRANSITION', 'The retainer is not running');
      }
      if (
        row.signatoryContactId &&
        !(await this.clients.isActiveContact(retainer.clientId, row.signatoryContactId, tx))
      ) {
        throw new CodedException(400, 'UNKNOWN_CONTACT', 'Pick a contact of this client');
      }
      const content = await this.content.live(tx, retainer, row);
      const required = missingFields(content, true).filter((field) => field.required);
      if (required.length > 0) {
        throw new CodedException(409, 'CONTRACT_INCOMPLETE', 'Required contract fields are empty', {
          missing: required,
        });
      }
      const year = Number(businessDate().slice(0, 4));
      const settings = await this.settings.row(tx);
      const number = formatContractNumber(
        settings.numberPrefix,
        year,
        await this.sources.numbering.next(tx, year),
      );
      const snapshot: ContractSnapshot = { ...content, displayNumber: number };
      const [updated] = await tx
        .update(retainerContracts)
        .set({
          status: 'issued',
          number,
          snapshot,
          pdfStatus: 'pending',
          issuedAt: new Date(),
          issuedById: actor.id,
          draftPdfStatus: null,
          draftPdfRequestedHash: null,
          draftPdfObjectKey: null,
          draftPdfAt: null,
          draftPdfHash: null,
        })
        .where(eq(retainerContracts.id, row.id))
        .returning();
      if (!updated) throw new Error('Contract update returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'retainer_contract.issued',
        entityType: 'retainer_contract',
        entityId: row.id,
        before: { status: 'draft' },
        after: { retainerId, status: 'issued', contractNumber: number },
      });
      return { issued: updated, preview: row.draftPdfObjectKey };
    });
    await this.pdfs.queueIssued(issued);
    await this.pdfs.discardPreview(preview);
    return this.get(actor, retainerId, contractId);
  }

  /** K8: an issued or signed contract is voided with a reason; its number stays used. */
  async void(
    actor: CurrentUserInfo,
    retainerId: string,
    contractId: string,
    input: VoidContract,
  ): Promise<RetainerContractDetail> {
    await this.db.transaction(async (tx) => {
      const { row } = await this.issuedFor(tx, actor, retainerId, contractId);
      await tx
        .update(retainerContracts)
        .set({
          status: 'void',
          voidReason: input.reason,
          voidedAt: new Date(),
          voidedById: actor.id,
        })
        .where(eq(retainerContracts.id, row.id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'retainer_contract.voided',
        entityType: 'retainer_contract',
        entityId: row.id,
        before: { status: row.status },
        after: { retainerId, status: 'void', contractNumber: row.number, reason: input.reason },
      });
    });
    return this.get(actor, retainerId, contractId);
  }

  /** K5: the signed scan with its date; a new upload is the next version of the signed copy. */
  async signed(
    actor: CurrentUserInfo,
    retainerId: string,
    contractId: string,
    input: SignedContract,
  ): Promise<RetainerContractDetail> {
    const preview = await this.db.transaction(async (tx) => {
      const { retainer, row } = await this.issuedFor(tx, actor, retainerId, contractId);
      const copy = await this.attachSignedCopy(tx, actor, {
        contractId: row.id,
        clientId: retainer.clientId,
        itemId: row.signedFileItemId,
        uploadId: input.uploadId,
        namePrefix: `${row.number} signed`,
      });
      await tx
        .update(retainerContracts)
        .set({ status: 'signed', signedOn: input.signedOn, signedFileItemId: copy.itemId })
        .where(eq(retainerContracts.id, row.id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'retainer_contract.signed',
        entityType: 'retainer_contract',
        entityId: row.id,
        before: { status: row.status, signedOn: row.signedOn },
        after: {
          retainerId,
          status: 'signed',
          contractNumber: row.number,
          signedOn: input.signedOn,
        },
      });
      return copy.preview;
    });
    if (preview) await this.files.queuePreviews();
    return this.get(actor, retainerId, contractId);
  }

  /**
   * K5, K10: attaches a signed scan as the contract's document, or as the next version of the
   * signed copy already there.
   */
  async attachSignedCopy(
    tx: Transaction,
    actor: CurrentUserInfo,
    copy: {
      contractId: string;
      clientId: string;
      itemId: string | null;
      uploadId: string;
      namePrefix: string;
    },
  ): Promise<{ itemId: string; preview: boolean }> {
    if (copy.itemId) {
      const { preview } = await this.files.addUploadVersion(tx, actor, copy.itemId, copy.uploadId);
      return { itemId: copy.itemId, preview };
    }
    const attached = await this.files.attachUpload(tx, actor, {
      ownerType: 'retainer_contract',
      ownerId: copy.contractId,
      clientId: copy.clientId,
      uploadId: copy.uploadId,
      namePrefix: copy.namePrefix,
    });
    return { itemId: attached.itemId, preview: attached.preview };
  }

  /**
   * K9 and K10: the retainer's issued and signed contracts with the cycles they cover, for
   * coverage of amendments.
   */
  async covering(executor: Executor, retainerId: string): Promise<CoveringContract[]> {
    const rows = await executor
      .select({
        id: retainerContracts.id,
        kind: retainerContracts.kind,
        startCycle: retainerContracts.startCycle,
        termStart: retainerTerms.startCycle,
        termCycles: retainerTerms.cycles,
      })
      .from(retainerContracts)
      .leftJoin(retainerTerms, eq(retainerTerms.id, retainerContracts.termId))
      .where(
        and(
          eq(retainerContracts.retainerId, retainerId),
          inArray(retainerContracts.status, [...LIVE_ISSUED]),
        ),
      )
      .orderBy(asc(retainerContracts.startCycle));
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      startCycle: row.termStart ?? row.startCycle,
      endCycle:
        row.kind === 'term' && row.termStart && row.termCycles
          ? row.termStart + row.termCycles - 1
          : null,
    }));
  }

  private async detail(
    executor: Executor,
    actor: CurrentUserInfo,
    retainer: RetainerAccess,
    row: ContractRow,
  ): Promise<RetainerContractDetail> {
    const [item] = await this.present(executor, retainer.id, [row]);
    if (!item) throw new NotFoundException();
    const seesNationalId = this.clients.coversNationalId(actor, retainer.client);
    const draft = row.status === 'draft';
    const content = draft
      ? await this.content.live(executor, retainer, row)
      : contractSnapshotSchema.parse(row.snapshot);
    const articles = await this.content.articles(executor, row.id);
    const contacts = row.signatoryContactId
      ? await this.clients.contactSummaries([row.signatoryContactId], executor)
      : new Map();
    const signatory = row.signatoryContactId ? contacts.get(row.signatoryContactId) : undefined;
    const draftHash = draft ? contractPdfHash('contract_draft', content) : null;
    return {
      ...item,
      signatoryContact: signatory ? { id: signatory.id, name: signatory.name } : null,
      articles,
      content: contentFor(content, seesNationalId),
      missing: missingFields(content, seesNationalId),
      absentBlocks: absentBlocks(content),
      draftPdf:
        draft && row.draftPdfStatus
          ? {
              state: row.draftPdfStatus,
              renderedAt: row.draftPdfAt?.toISOString() ?? null,
              outdated: row.draftPdfStatus === 'ready' && row.draftPdfHash !== draftHash,
            }
          : null,
      canManage: canManageContracts(actor, retainer) && !row.archivedAt,
    };
  }

  private async present(
    executor: Executor,
    retainerId: string,
    rows: readonly ContractRow[],
  ): Promise<RetainerContract[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const annexes = await executor
      .select({
        annex: retainerContractAnnexes,
        amendmentNumber: retainerAmendments.number,
      })
      .from(retainerContractAnnexes)
      .innerJoin(retainerAmendments, eq(retainerAmendments.id, retainerContractAnnexes.amendmentId))
      .where(inArray(retainerContractAnnexes.contractId, ids))
      .orderBy(asc(retainerContractAnnexes.annexNumber));
    const termIds = rows.flatMap((row) => (row.termId ? [row.termId] : []));
    const terms = termIds.length
      ? await executor.select().from(retainerTerms).where(inArray(retainerTerms.id, termIds))
      : [];
    const people = await this.users.summaries(
      [
        ...rows.flatMap((row) => (row.issuedById ? [row.issuedById] : [])),
        ...annexes.map(({ annex }) => annex.issuedById),
      ],
      executor,
    );
    const person = (id: string | null) => {
      const user = id ? people.get(id) : undefined;
      return user ? { id: user.id, name: user.name } : null;
    };
    const changed = await this.changedSinceIssue(executor, retainerId, rows);
    return rows.map((row) => {
      const term = terms.find((candidate) => candidate.id === row.termId);
      return {
        id: row.id,
        retainerId: row.retainerId,
        kind: row.kind,
        term:
          term?.startCycle && term.cycles && term.startDate && term.endDate
            ? {
                id: term.id,
                number: term.number,
                startCycle: term.startCycle,
                cycles: term.cycles,
                startDate: term.startDate,
                endDate: term.endDate,
              }
            : null,
        startCycle: row.startCycle,
        status: row.status,
        number: row.number,
        contractDate: row.contractDate,
        pdf: row.status === 'draft' || !row.pdfStatus ? null : { state: row.pdfStatus },
        signed:
          row.signedOn && row.signedFileItemId
            ? { signedOn: row.signedOn, fileItemId: row.signedFileItemId }
            : null,
        voided:
          row.voidedAt && row.voidReason
            ? { at: row.voidedAt.toISOString(), reason: row.voidReason }
            : null,
        issuedAt: row.issuedAt?.toISOString() ?? null,
        issuedBy: person(row.issuedById),
        changedSinceIssue: changed.has(row.id),
        annexes: annexes
          .filter(({ annex }) => annex.contractId === row.id)
          .map(({ annex, amendmentNumber }) =>
            presentAnnex(annex, amendmentNumber, person(annex.issuedById)),
          ),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  /**
   * K9: issued and signed contracts whose term was cancelled or edited since the issue, or whose
   * cycles took an applied change or reschedule amendment after the issue that has no annex of
   * the contract. A term's schedule is compared only while no such amendment is there, since
   * amendments move its amounts too and are answered by annexes.
   */
  private async changedSinceIssue(
    executor: Executor,
    retainerId: string,
    rows: readonly ContractRow[],
  ): Promise<Set<string>> {
    const changed = new Set<string>();
    const issued = rows.filter((row) => row.status === 'issued' || row.status === 'signed');
    if (issued.length === 0) return changed;
    const coverage = await this.covering(executor, retainerId);
    const amendments = await executor
      .select({
        id: retainerAmendments.id,
        effectiveCycle: retainerAmendments.effectiveCycle,
        appliedAt: retainerAmendments.appliedAt,
      })
      .from(retainerAmendments)
      .where(
        and(
          eq(retainerAmendments.retainerId, retainerId),
          eq(retainerAmendments.status, 'applied'),
          ne(retainerAmendments.kind, 'quote_renewal'),
        ),
      );
    const annexed = await executor
      .select({
        contractId: retainerContractAnnexes.contractId,
        amendmentId: retainerContractAnnexes.amendmentId,
      })
      .from(retainerContractAnnexes)
      .where(
        and(
          inArray(
            retainerContractAnnexes.contractId,
            issued.map((row) => row.id),
          ),
          ne(retainerContractAnnexes.status, 'void'),
        ),
      );
    for (const row of issued) {
      const since = row.issuedAt ?? row.createdAt;
      const amended = amendments.filter(
        (amendment) =>
          amendment.appliedAt &&
          amendment.appliedAt > since &&
          amendment.effectiveCycle !== null &&
          coveringContract(coverage, amendment.effectiveCycle)?.id === row.id,
      );
      const unannexed = amended.some(
        (amendment) =>
          !annexed.some(
            (annex) => annex.contractId === row.id && annex.amendmentId === amendment.id,
          ),
      );
      if (unannexed) {
        changed.add(row.id);
        continue;
      }
      if (!row.termId) continue;
      const term = await this.terms.forContract(executor, retainerId, row.termId);
      const snapshot = contractSnapshotSchema.parse(row.snapshot);
      if (!term || term.status === 'cancelled') {
        changed.add(row.id);
        continue;
      }
      const termEdited =
        snapshot.term.startDate !== term.startDate ||
        snapshot.term.cycles !== term.cycles ||
        snapshot.term.endDate !== term.endDate ||
        snapshot.term.endAction !== term.endAction ||
        snapshot.fees.agreedTotalMinor !== term.agreedTotalMinor ||
        (amended.length === 0 &&
          snapshot.fees.schedule.some(
            (cycle, index) => cycle.amountMinor !== (term.schedule[index] ?? 0),
          ));
      if (termEdited) changed.add(row.id);
    }
    return changed;
  }

  /** Locks a live draft the actor manages on a writable retainer. */
  private async draftFor(
    tx: Transaction,
    actor: CurrentUserInfo,
    retainerId: string,
    contractId: string,
  ): Promise<{ retainer: RetainerAccess; row: ContractRow }> {
    const retainer = await contractRetainer(tx, this.clients, actor, retainerId, {
      manage: true,
      forUpdate: true,
    });
    const row = await contractOf(tx, retainerId, contractId, { forUpdate: true });
    assertRetainerWritable(retainer);
    if (row.status !== 'draft' || row.archivedAt) {
      throw new CodedException(409, 'INVALID_TRANSITION', 'Only a draft changes');
    }
    return { retainer, row };
  }

  /** Locks an issued or signed contract the actor manages; an ended retainer still keeps paper. */
  private async issuedFor(
    tx: Transaction,
    actor: CurrentUserInfo,
    retainerId: string,
    contractId: string,
  ): Promise<{ retainer: RetainerAccess; row: ContractRow }> {
    const retainer = await contractRetainer(tx, this.clients, actor, retainerId, {
      manage: true,
      forUpdate: true,
    });
    const row = await contractOf(tx, retainerId, contractId, { forUpdate: true });
    assertRetainerNotArchived(retainer);
    if (row.status !== 'issued' && row.status !== 'signed') {
      throw new CodedException(409, 'INVALID_TRANSITION', 'The contract is not issued');
    }
    return { retainer, row };
  }

  /** K1, edge case 10: one live contract per term, one per open-ended start cycle. */
  private async assertNoLiveContract(
    tx: Transaction,
    retainerId: string,
    kind: ContractRow['kind'],
    termId: string | null,
    startCycle: number,
  ): Promise<void> {
    const [existing] = await tx
      .select({ id: retainerContracts.id })
      .from(retainerContracts)
      .where(
        and(
          eq(retainerContracts.retainerId, retainerId),
          ne(retainerContracts.status, 'void'),
          isNull(retainerContracts.archivedAt),
          termId
            ? eq(retainerContracts.termId, termId)
            : and(eq(retainerContracts.kind, kind), eq(retainerContracts.startCycle, startCycle)),
        ),
      )
      .limit(1);
    if (existing) {
      throw new CodedException(409, 'CONTRACT_EXISTS', 'Open the existing contract', {
        contractId: existing.id,
      });
    }
  }

  /**
   * Replaces a draft's articles: kept by id, added without one, archived when left out. Returns
   * the titles before and after when anything changed.
   */
  private async replaceArticles(
    tx: Transaction,
    contractId: string,
    articles: NonNullable<UpdateContract['articles']>,
  ): Promise<{ before: string[]; after: string[] } | null> {
    const before = await this.content.articles(tx, contractId);
    const known = new Set(before.map((article) => article.id));
    const ids = articles.flatMap((article) => (article.id ? [article.id] : []));
    if (new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
      throw new CodedException(400, 'INVALID_ORDER', 'An article is not in this contract');
    }
    const kept = new Set(ids);
    const removed = before.filter((article) => !kept.has(article.id)).map(({ id }) => id);
    if (removed.length > 0) {
      await tx
        .update(retainerContractArticles)
        .set({ archivedAt: new Date() })
        .where(inArray(retainerContractArticles.id, removed));
    }
    for (const [index, article] of articles.entries()) {
      const fields = { position: index + 1, title: article.title, body: article.body };
      if (article.id) {
        await tx
          .update(retainerContractArticles)
          .set(fields)
          .where(eq(retainerContractArticles.id, article.id));
      } else {
        await tx.insert(retainerContractArticles).values({ contractId, ...fields });
      }
    }
    const after = await this.content.articles(tx, contractId);
    if (JSON.stringify(before) === JSON.stringify(after)) return null;
    return { before: before.map(({ title }) => title), after: after.map(({ title }) => title) };
  }
}

/** K2, K7: at most 40 articles, no unknown `{…}`. */
function assertArticles(articles: NonNullable<UpdateContract['articles']>): void {
  if (articles.length > CONTRACT_LIMITS.articles) {
    throw new CodedException(
      409,
      'LIMIT_REACHED',
      `A contract holds at most ${CONTRACT_LIMITS.articles} articles`,
    );
  }
  if (articles.some((article) => unknownPlaceholders(article.body).length > 0)) {
    throw new CodedException(400, 'UNKNOWN_PLACEHOLDER', 'An article names an unknown placeholder');
  }
}

export function presentAnnex(
  annex: AnnexRow,
  amendmentNumber: number,
  issuedBy: { id: string; name: string } | null,
): ContractAnnex {
  return {
    id: annex.id,
    contractId: annex.contractId,
    annexNumber: annex.annexNumber,
    amendment: { id: annex.amendmentId, number: amendmentNumber },
    status: annex.status,
    annexDate: annex.annexDate,
    pdf: { state: annex.pdfStatus },
    signed:
      annex.signedOn && annex.signedFileItemId
        ? { signedOn: annex.signedOn, fileItemId: annex.signedFileItemId }
        : null,
    voided:
      annex.voidedAt && annex.voidReason
        ? { at: annex.voidedAt.toISOString(), reason: annex.voidReason }
        : null,
    issuedBy,
    createdAt: annex.createdAt.toISOString(),
  };
}
