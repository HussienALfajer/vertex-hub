import type {
  Amendment,
  ContractAnnex,
  RetainerContract,
  RetainerTerm,
} from '@vertex-hub/contracts';

/**
 * The issued or signed contract covering a cycle (F05C K9, K10, as the API decides it): the term
 * contract whose term holds the cycle, else the contract covering onward (open-ended, or a term
 * that continues after its end, K1) that starts latest at or before it.
 */
export function coveringContract(
  contracts: readonly RetainerContract[],
  terms: readonly Pick<RetainerTerm, 'id' | 'endAction'>[],
  cycle: number,
): RetainerContract | null {
  const continues = new Set(
    terms.filter((term) => term.endAction === 'continue').map((term) => term.id),
  );
  const live = contracts.filter(
    (contract) => contract.status === 'issued' || contract.status === 'signed',
  );
  const bounded = live.find(
    (contract) =>
      contract.term &&
      !continues.has(contract.term.id) &&
      contract.term.startCycle <= cycle &&
      cycle < contract.term.startCycle + contract.term.cycles,
  );
  if (bounded) return bounded;
  const onward = live
    .filter(
      (contract) =>
        (!contract.term || continues.has(contract.term.id)) &&
        (contract.term?.startCycle ?? contract.startCycle) <= cycle,
    )
    .sort((a, b) => (b.term?.startCycle ?? b.startCycle) - (a.term?.startCycle ?? a.startCycle));
  return onward[0] ?? null;
}

/** What an amendment's card offers (K10): its live annex, or the contract that would take one. */
export type AnnexState =
  | { kind: 'annex'; contract: RetainerContract; annex: ContractAnnex }
  | { kind: 'available'; contract: RetainerContract }
  | null;

export function annexState(
  amendment: Pick<Amendment, 'id' | 'kind' | 'status' | 'effectiveCycle'>,
  contracts: readonly RetainerContract[],
  terms: readonly Pick<RetainerTerm, 'id' | 'endAction'>[],
): AnnexState {
  for (const contract of contracts) {
    const annex = contract.annexes.find(
      (entry) => entry.amendment.id === amendment.id && entry.status !== 'void',
    );
    if (annex) return { kind: 'annex', contract, annex };
  }
  if (amendment.kind === 'quote_renewal' || amendment.status !== 'applied') return null;
  const contract = coveringContract(contracts, terms, amendment.effectiveCycle);
  return contract ? { kind: 'available', contract } : null;
}
