import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AnnexSnapshot,
  type ContractAnnex,
  contractSnapshotSchema,
  cyclePeriod,
  type IssueAnnex,
  type SignedContract,
  type VoidContract,
} from '@vertex-hub/contracts';
import {
  type Database,
  retainerAmendmentLines,
  retainerAmendments,
  retainerContractAnnexes,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, eq, max, ne } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { GeneratedFiles } from '../files/index.js';
import { type AnnexRow, annexOf, contractOf, contractRetainer } from './contract-access.js';
import { actorOf } from './project-access.js';
import { assertRetainerNotArchived } from './retainer-access.js';
import { ContractPdfs } from './retainer-contract-pdfs.js';
import {
  coveringContract,
  presentAnnex,
  RetainerContractsService,
} from './retainer-contracts.service.js';

/**
 * Contract annexes (spec F05C K10): issued on demand for an applied `change` or `reschedule`
 * amendment whose effective cycle an issued or signed contract covers; numbered per contract,
 * frozen with their PDF, signed and voided like contracts. Every change holds the retainer row
 * lock (G2) and writes its audit entry in the same transaction (G1).
 */
@Injectable()
export class RetainerContractAnnexesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly users: UserDirectory,
    private readonly contracts: RetainerContractsService,
    private readonly pdfs: ContractPdfs,
    private readonly files: GeneratedFiles,
  ) {}

  async issue(
    actor: CurrentUserInfo,
    retainerId: string,
    amendmentId: string,
    input: IssueAnnex,
  ): Promise<ContractAnnex> {
    const annex = await this.db.transaction(async (tx) => {
      const retainer = await contractRetainer(tx, this.clients, actor, retainerId, {
        manage: true,
        forUpdate: true,
      });
      assertRetainerNotArchived(retainer);
      const [amendment] = await tx
        .select()
        .from(retainerAmendments)
        .where(
          and(
            eq(retainerAmendments.id, amendmentId),
            eq(retainerAmendments.retainerId, retainerId),
          ),
        );
      if (!amendment) throw new NotFoundException();
      if (
        amendment.kind === 'quote_renewal' ||
        amendment.status !== 'applied' ||
        amendment.effectiveCycle === null
      ) {
        throw new CodedException(
          409,
          'INVALID_TRANSITION',
          'Only an applied change or reschedule gets an annex',
        );
      }
      const covering = coveringContract(
        await this.contracts.covering(tx, retainerId),
        amendment.effectiveCycle,
      );
      if (!covering) {
        throw new CodedException(409, 'NO_CONTRACT', 'No issued contract covers this cycle');
      }
      const [taken] = await tx
        .select({ id: retainerContractAnnexes.id })
        .from(retainerContractAnnexes)
        .where(
          and(
            eq(retainerContractAnnexes.amendmentId, amendmentId),
            ne(retainerContractAnnexes.status, 'void'),
          ),
        );
      if (taken) {
        throw new CodedException(409, 'INVALID_TRANSITION', 'The amendment already has an annex');
      }
      const contract = await contractOf(tx, retainerId, covering.id, { forUpdate: true });
      const [last] = await tx
        .select({ highest: max(retainerContractAnnexes.annexNumber) })
        .from(retainerContractAnnexes)
        .where(eq(retainerContractAnnexes.contractId, contract.id));
      const annexNumber = (last?.highest ?? 0) + 1;
      const parties = contractSnapshotSchema.parse(contract.snapshot);
      const lines = await tx
        .select({
          kind: retainerAmendmentLines.kind,
          label: retainerAmendmentLines.label,
          quantityDelta: retainerAmendmentLines.quantityDelta,
          revisionLimit: retainerAmendmentLines.revisionLimit,
        })
        .from(retainerAmendmentLines)
        .where(eq(retainerAmendmentLines.amendmentId, amendmentId))
        .orderBy(asc(retainerAmendmentLines.position));
      const snapshot: AnnexSnapshot = {
        annexNumber,
        contractNumber: contract.number ?? '',
        annexDate: input.annexDate,
        agency: {
          legalName: parties.agency.legalName,
          tradeName: parties.agency.tradeName,
          representativeName: parties.agency.representativeName,
          representativeTitle: parties.agency.representativeTitle,
          website: parties.agency.website,
          address: parties.agency.address,
          phone: parties.agency.phone,
        },
        client: {
          signatoryName: parties.client.signatoryName,
          tradeName: parties.client.tradeName,
          title: parties.client.title,
        },
        amendment: {
          number: amendment.number,
          kind: amendment.kind,
          // The scope enum still lists F05B's `month`, which migration 0063 rewrote to `cycle`.
          scope: amendment.scope === 'month' ? 'cycle' : amendment.scope,
          effectiveCycle: amendment.effectiveCycle,
          ...cyclePeriod(retainer.startDate, amendment.effectiveCycle),
          lines: lines.map((line) => ({
            kind: line.kind,
            label: line.label,
            quantityDelta: line.quantityDelta ?? 0,
            revisionLimit: line.revisionLimit,
          })),
          currency: retainer.currency,
          amountDeltaMinor: amendment.amountDeltaMinor,
          schedule: amendment.schedule
            ? amendment.schedule.map((cycle) => ({
                ...cycle,
                ...cyclePeriod(retainer.startDate, cycle.cycle),
              }))
            : null,
          reason: amendment.reason,
        },
      };
      const [row] = await tx
        .insert(retainerContractAnnexes)
        .values({
          contractId: contract.id,
          amendmentId,
          annexNumber,
          annexDate: input.annexDate,
          snapshot,
          issuedById: actor.id,
        })
        .returning();
      if (!row) throw new Error('Annex insert returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'retainer_contract_annex.issued',
        entityType: 'retainer_contract_annex',
        entityId: row.id,
        after: {
          retainerId,
          contractId: contract.id,
          contractNumber: contract.number,
          annexNumber,
          amendmentId,
          annexDate: input.annexDate,
        },
      });
      return row;
    });
    await this.pdfs.queueAnnex(annex);
    return this.present(annex);
  }

  /** K10: an issued or signed annex is voided with a reason. */
  async void(
    actor: CurrentUserInfo,
    retainerId: string,
    contractId: string,
    annexId: string,
    input: VoidContract,
  ): Promise<ContractAnnex> {
    const annex = await this.db.transaction(async (tx) => {
      const { annex, contractNumber } = await this.lock(tx, actor, retainerId, contractId, annexId);
      const [updated] = await tx
        .update(retainerContractAnnexes)
        .set({
          status: 'void',
          voidReason: input.reason,
          voidedAt: new Date(),
          voidedById: actor.id,
        })
        .where(eq(retainerContractAnnexes.id, annex.id))
        .returning();
      if (!updated) throw new Error('Annex update returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'retainer_contract_annex.voided',
        entityType: 'retainer_contract_annex',
        entityId: annex.id,
        before: { status: annex.status },
        after: {
          retainerId,
          contractId,
          contractNumber,
          annexNumber: annex.annexNumber,
          status: 'void',
          reason: input.reason,
        },
      });
      return updated;
    });
    return this.present(annex);
  }

  /** K10, K5: the signed annex's scan with its date; a new upload is the next version. */
  async signed(
    actor: CurrentUserInfo,
    retainerId: string,
    contractId: string,
    annexId: string,
    input: SignedContract,
  ): Promise<ContractAnnex> {
    const { annex, preview } = await this.db.transaction(async (tx) => {
      const { annex, contractNumber, clientId } = await this.lock(
        tx,
        actor,
        retainerId,
        contractId,
        annexId,
      );
      const copy = await this.contracts.attachSignedCopy(tx, actor, {
        contractId,
        clientId,
        itemId: annex.signedFileItemId,
        uploadId: input.uploadId,
        namePrefix: `${contractNumber} annex ${annex.annexNumber} signed`,
      });
      const [updated] = await tx
        .update(retainerContractAnnexes)
        .set({ status: 'signed', signedOn: input.signedOn, signedFileItemId: copy.itemId })
        .where(eq(retainerContractAnnexes.id, annex.id))
        .returning();
      if (!updated) throw new Error('Annex update returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'retainer_contract_annex.signed',
        entityType: 'retainer_contract_annex',
        entityId: annex.id,
        before: { status: annex.status, signedOn: annex.signedOn },
        after: {
          retainerId,
          contractId,
          contractNumber,
          annexNumber: annex.annexNumber,
          status: 'signed',
          signedOn: input.signedOn,
        },
      });
      return { annex: updated, preview: copy.preview };
    });
    if (preview) await this.files.queuePreviews();
    return this.present(annex);
  }

  /** Locks a live (issued or signed) annex the actor manages. */
  private async lock(
    tx: Transaction,
    actor: CurrentUserInfo,
    retainerId: string,
    contractId: string,
    annexId: string,
  ): Promise<{ annex: AnnexRow; contractNumber: string | null; clientId: string }> {
    const retainer = await contractRetainer(tx, this.clients, actor, retainerId, {
      manage: true,
      forUpdate: true,
    });
    const contract = await contractOf(tx, retainerId, contractId, { forUpdate: true });
    const annex = await annexOf(tx, contractId, annexId, { forUpdate: true });
    assertRetainerNotArchived(retainer);
    if (annex.status === 'void') {
      throw new CodedException(409, 'INVALID_TRANSITION', 'The annex is void');
    }
    return { annex, contractNumber: contract.number, clientId: retainer.clientId };
  }

  private async present(annex: AnnexRow): Promise<ContractAnnex> {
    const [amendment] = await this.db
      .select({ number: retainerAmendments.number })
      .from(retainerAmendments)
      .where(eq(retainerAmendments.id, annex.amendmentId));
    const people = await this.users.summaries([annex.issuedById]);
    const issuer = people.get(annex.issuedById);
    return presentAnnex(
      annex,
      amendment?.number ?? 0,
      issuer ? { id: issuer.id, name: issuer.name } : null,
    );
  }
}
