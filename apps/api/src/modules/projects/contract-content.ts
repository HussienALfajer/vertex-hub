import { Injectable } from '@nestjs/common';
import {
  absentContractBlocks,
  CONTRACT_AGENCY_FIELDS,
  CONTRACT_CLIENT_FIELDS,
  CONTRACT_REQUIRED_FIELDS,
  type ContractBlock,
  type ContractKind,
  type ContractMissingField,
  type ContractSnapshot,
  cyclePeriod,
  fillContractValues,
  termCycles,
} from '@vertex-hub/contracts';
import {
  type Database,
  retainerContractArticles,
  retainerDeliverables,
  retainers,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { payloadHash } from '../../core/jobs/index.js';
import { ClientDirectory } from '../clients/index.js';
import type { ContractRow } from './contract-access.js';
import { ContractSettingsService } from './contract-settings.service.js';
import { ContractSources } from './contract-sources.js';
import type { RetainerAccess } from './retainer-access.js';
import { type ContractTerm, RetainerTermsService } from './retainer-terms.service.js';

type Executor = Database | Transaction;

/** What a contract is printed from: its own fields and the retainer it belongs to. */
export interface ContractSource {
  kind: ContractKind;
  startCycle: number;
  contractDate: string;
  signatoryContactId: string | null;
  /** The contract number once issued; null on a draft. */
  displayNumber: string | null;
  articles: readonly { title: string; body: string }[];
  retainer: RetainerAccess & { monthlyFeeMinor: number | null };
  /** `term` contracts only. */
  term: ContractTerm | null;
}

/** The kinds of contract render, as the PDF hash names them. */
export type ContractRenderKind = 'contract' | 'contract_draft' | 'annex';

export const contractPdfHash = (kind: ContractRenderKind, snapshot: object) =>
  payloadHash({ kind, snapshot });

/**
 * The render payload of a contract (F05C K3, K6, K7): the parties from the contract settings and
 * the client, the articles with their values filled, and the `services`, `term` and `fees`
 * blocks read live. Issuing freezes it as the contract's snapshot.
 */
@Injectable()
export class ContractContent {
  constructor(
    private readonly clients: ClientDirectory,
    private readonly settings: ContractSettingsService,
    private readonly sources: ContractSources,
    private readonly terms: RetainerTermsService,
  ) {}

  /** The contract's own articles in order. */
  articles(executor: Executor, contractId: string) {
    return executor
      .select({
        id: retainerContractArticles.id,
        title: retainerContractArticles.title,
        body: retainerContractArticles.body,
      })
      .from(retainerContractArticles)
      .where(
        and(
          eq(retainerContractArticles.contractId, contractId),
          isNull(retainerContractArticles.archivedAt),
        ),
      )
      .orderBy(asc(retainerContractArticles.position), asc(retainerContractArticles.id));
  }

  /** What a draft prints now (K3), or what an issue would freeze with `displayNumber`. */
  async live(
    executor: Executor,
    retainer: RetainerAccess,
    row: ContractRow,
    displayNumber: string | null = null,
  ): Promise<ContractSnapshot> {
    const [fee] = await executor
      .select({ monthlyFeeMinor: retainers.monthlyFeeMinor })
      .from(retainers)
      .where(eq(retainers.id, retainer.id));
    const term = row.termId
      ? await this.terms.forContract(executor, retainer.id, row.termId)
      : null;
    return this.build(executor, {
      kind: row.kind,
      startCycle: row.startCycle,
      contractDate: row.contractDate,
      signatoryContactId: row.signatoryContactId,
      displayNumber,
      articles: await this.articles(executor, row.id),
      retainer: { ...retainer, monthlyFeeMinor: fee?.monthlyFeeMinor ?? null },
      term,
    });
  }

  async build(executor: Executor, source: ContractSource): Promise<ContractSnapshot> {
    const { retainer, term } = source;
    const settings = await this.settings.row(executor);
    const party = await this.clients.contractParty(
      retainer.clientId,
      source.signatoryContactId,
      executor,
    );
    if (!party) throw new Error('The retainer has no client');
    const signatory = party.signatory;
    const values = {
      agency_name: settings.tradeName,
      client_name: party.tradeName,
      retainer_name: retainer.name,
      payment_terms_days: String(await this.sources.numbering.paymentTermsDays(executor)),
    };
    const deliverables = await executor
      .select({
        kind: retainerDeliverables.kind,
        label: retainerDeliverables.label,
        quantity: retainerDeliverables.monthlyQuantity,
        revisionLimit: retainerDeliverables.revisionLimit,
      })
      .from(retainerDeliverables)
      .where(
        and(
          eq(retainerDeliverables.retainerId, retainer.id),
          isNull(retainerDeliverables.archivedAt),
        ),
      )
      .orderBy(asc(retainerDeliverables.position), asc(retainerDeliverables.id));
    return {
      displayNumber: source.displayNumber,
      contractDate: source.contractDate,
      agency: {
        legalName: settings.legalName,
        tradeName: settings.tradeName,
        companyType: settings.companyType,
        registrationNumber: settings.registrationNumber,
        address: settings.address,
        phone: settings.phone,
        email: settings.email,
        website: settings.website,
        representativeName: settings.representativeName,
        representativeTitle: settings.representativeTitle,
      },
      client: {
        signatoryName: signatory?.name ?? '',
        fatherName: signatory?.fatherName ?? '',
        tradeName: party.tradeName,
        nationalId: signatory?.nationalId ?? '',
        registrationNumber: party.registrationNumber ?? '',
        phone: signatory?.phone ?? '',
        email: signatory?.email ?? '',
        address: party.billingAddress ?? '',
        title: signatory?.jobTitle ?? '',
      },
      slogan: settings.slogan,
      articles: source.articles.map((article, index) => ({
        number: index + 1,
        title: article.title,
        body: fillContractValues(article.body, values),
      })),
      services: {
        quote: await this.sources.quotes.monthlyServices(executor, {
          quoteId: term?.quoteId ?? null,
          retainerId: retainer.id,
        }),
        deliverables,
      },
      term: term
        ? {
            kind: 'term',
            retainerName: retainer.name,
            startDate: term.startDate,
            cycleDay: cycleDay(retainer.startDate),
            cycles: term.cycles,
            endDate: term.endDate,
            endAction: term.endAction,
          }
        : {
            kind: 'open_ended',
            retainerName: retainer.name,
            startDate: cyclePeriod(retainer.startDate, source.startCycle).periodStart,
            cycleDay: cycleDay(retainer.startDate),
            cycles: null,
            endDate: null,
            endAction: null,
          },
      fees: term
        ? {
            currency: retainer.currency,
            agreedTotalMinor: term.agreedTotalMinor,
            schedule: termCycles(term.startCycle, term.cycles).map((cycle, index) => ({
              cycle,
              ...cyclePeriod(retainer.startDate, cycle),
              amountMinor: term.schedule[index] ?? 0,
            })),
            feeMinor: null,
          }
        : {
            currency: retainer.currency,
            agreedTotalMinor: null,
            schedule: [],
            feeMinor: retainer.monthlyFeeMinor,
          },
    };
  }
}

/** The day of the month cycles start on: the start date's day (F05C Y1). */
const cycleDay = (startDate: string) => Number(startDate.slice(8, 10));

/**
 * The party fields that print empty (K4): the required ones block the issue. The national ID is
 * left out for callers who may not see it, so its presence does not show either.
 */
export function missingFields(
  content: ContractSnapshot,
  seesNationalId: boolean,
): ContractMissingField[] {
  const missing: ContractMissingField[] = [];
  for (const field of CONTRACT_AGENCY_FIELDS) {
    if (content.agency[field].trim()) continue;
    const required = (CONTRACT_REQUIRED_FIELDS.agency as readonly string[]).includes(field);
    missing.push({ party: 'agency', field, required });
  }
  for (const field of CONTRACT_CLIENT_FIELDS) {
    if (field === 'nationalId' && !seesNationalId) continue;
    if ((content.client[field] ?? '').trim()) continue;
    const required = (CONTRACT_REQUIRED_FIELDS.client as readonly string[]).includes(field);
    missing.push({ party: 'client', field, required });
  }
  return missing;
}

/** K7: the blocks no article of the content prints. */
export const absentBlocks = (content: ContractSnapshot): ContractBlock[] =>
  absentContractBlocks(content.articles.map((article) => article.body));

/** The content as the caller may see it: the national ID only with its access (edge case 12). */
export function contentFor(content: ContractSnapshot, seesNationalId: boolean): ContractSnapshot {
  if (seesNationalId) return content;
  const { nationalId: _hidden, ...client } = content.client;
  return { ...content, client };
}
