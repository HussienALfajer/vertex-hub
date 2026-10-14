import { Injectable } from '@nestjs/common';
import type { ContractSnapshot } from '@vertex-hub/contracts';
import type { Database, Transaction } from '@vertex-hub/db';

type Executor = Database | Transaction;

/**
 * What a contract takes from `invoices` (F05C K4, K7): the year's contract numbers, kept with the
 * other document numbers, and the payment terms the articles print.
 */
export interface ContractNumbering {
  /** Takes the next number of the year; the counter row stays locked until the commit. */
  next(tx: Transaction, year: number): Promise<number>;
  /** The number the next issue of the year would take, without taking it. */
  peek(executor: Executor, year: number): Promise<number>;
  paymentTermsDays(executor: Executor): Promise<number>;
}

/** What a contract takes from `quotes` (K7 `{services}`): the accepted quote's monthly section. */
export interface ContractQuotes {
  /** The quote `quoteId`, else the retainer's latest accepted quote; null without one. */
  monthlyServices(
    executor: Executor,
    ref: { quoteId: string | null; retainerId: string },
  ): Promise<ContractSnapshot['services']['quote']>;
}

/**
 * Lets `invoices` and `quotes`, which import `projects`, give contracts what they own without
 * `projects` importing them (as the hooks do). Each registers its part on start-up.
 */
@Injectable()
export class ContractSources {
  private numberingSource: ContractNumbering | null = null;
  private quotesSource: ContractQuotes | null = null;

  registerNumbering(source: ContractNumbering): void {
    this.numberingSource = source;
  }

  registerQuotes(source: ContractQuotes): void {
    this.quotesSource = source;
  }

  get numbering(): ContractNumbering {
    if (!this.numberingSource) throw new Error('No contract numbering registered (invoices)');
    return this.numberingSource;
  }

  get quotes(): ContractQuotes {
    if (!this.quotesSource) throw new Error('No contract quote source registered (quotes)');
    return this.quotesSource;
  }
}
