import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  businessDate,
  type ContractAnnex,
  type ContractAnnexStatus,
  type ContractStatus,
  currentCycleNumber,
  type RetainerContract,
  type RetainerDetail,
  type RetainerTerm,
} from '@vertex-hub/contracts';
import {
  Badge,
  type BadgeProps,
  Button,
  Callout,
  EmptyState,
  Skeleton,
  toast,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import {
  DownloadIcon,
  FilePlusIcon,
  FileTextIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { formatCalendarDate, formatNumber, formatPeriod } from '../../lib/format';
import {
  contractName,
  type Fallback,
  IssueContractDialog,
  SignedCopyDialog,
  VoidDialog,
} from './contract-dialogs';
import {
  annexPdfUrl,
  contractPdfUrl,
  retainerContractsQuery,
  usePrepareContract,
  useRenderAnnexPdf,
  useRenderContractPdf,
  useSignAnnex,
  useSignContract,
  useVoidAnnex,
  useVoidContract,
} from './retainers.queries';

export const CONTRACT_STATUS_TONES: Record<
  ContractStatus | ContractAnnexStatus,
  NonNullable<BadgeProps['tone']>
> = {
  draft: 'warning',
  issued: 'info',
  signed: 'success',
  void: 'neutral',
};

/** "Term 2 · cycles 3–5 (20 Oct 2026 – 19 Jan 2027)" or "Open-ended from cycle 4". */
export function contractCoverage(t: TFunction, contract: RetainerContract): string {
  if (contract.term) {
    return t('retainers.contracts.coversTerm', {
      term: formatNumber(contract.term.number),
      from: formatNumber(contract.term.startCycle),
      to: formatNumber(contract.term.startCycle + contract.term.cycles - 1),
      period: formatPeriod(contract.term.startDate, contract.term.endDate),
    });
  }
  return t('retainers.contracts.coversOpenEnded', {
    cycle: formatNumber(contract.startCycle),
  });
}

/** The contracts that are neither void nor discarded: one per term, one open-ended (K1). */
const liveContract = (contract: RetainerContract) => contract.status !== 'void';

/**
 * Whether "Prepare contract" shows on a term card (K2): a scheduled or active term without a
 * live contract.
 */
export function termNeedsContract(
  term: Pick<RetainerTerm, 'id' | 'status'>,
  contracts: readonly RetainerContract[],
): boolean {
  return (
    (term.status === 'active' || term.status === 'scheduled') &&
    !contracts.some((contract) => contract.term?.id === term.id && liveContract(contract))
  );
}

/** K2: "Prepare contract" for a term (`termId`) or the open-ended retainer. */
export function PrepareContractButton({
  retainerId,
  termId,
  variant = 'outline',
}: {
  retainerId: string;
  termId?: string;
  variant?: 'outline' | 'primary';
}) {
  const { t } = useTranslation();
  const prepare = usePrepareContract(retainerId);
  const navigate = useNavigate();
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={prepare.isPending}
      focusableWhenDisabled
      onClick={async () => {
        try {
          const draft = await prepare.mutateAsync(
            termId ? { kind: 'term', termId } : { kind: 'open_ended' },
          );
          toast.add({ title: t('retainers.contracts.prepared'), type: 'success' });
          // The editor opens on the new draft.
          await navigate({
            to: '/retainers/$retainerId/contracts/$contractId',
            params: { retainerId, contractId: draft.id },
          });
        } catch (error) {
          toast.add({ title: errorMessage(t, error), type: 'error' });
        }
      }}
    >
      <FilePlusIcon />
      {termId ? t('retainers.contracts.prepare') : t('retainers.contracts.prepareOpenEnded')}
    </Button>
  );
}

/**
 * F05C screen 5, the Contracts section: each contract of the retainer with its annexes, and the
 * actions of contract managers (client scope with money access, G3).
 */
export function ContractsSection({
  retainer,
  terms,
}: {
  retainer: RetainerDetail;
  terms: RetainerTerm[];
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const contracts = useQuery(retainerContractsQuery(retainer.id));
  const { canBill: canManage, canEditMoney: canPrepare } = retainer.permissions;
  const items = contracts.data?.items ?? [];
  // An open-ended contract starts at the current cycle (cycle 1 before the start); a term holding
  // that cycle covers it with its own contract (K1, as the API refuses it).
  const current = Math.max(1, currentCycleNumber(retainer.startDate, businessDate()));
  const openEnded =
    canPrepare &&
    !terms.some(
      (term) =>
        (term.status === 'active' || term.status === 'scheduled') &&
        term.startCycle <= current &&
        current < term.startCycle + term.cycles,
    ) &&
    !items.some((contract) => contract.kind === 'open_ended' && liveContract(contract));
  const prepare = openEnded && <PrepareContractButton retainerId={retainer.id} variant="primary" />;

  return (
    <section className="flex flex-col gap-3" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 ref={heading} id={titleId} tabIndex={-1} className="text-lg font-bold">
          {t('retainers.contracts.title')}
        </h2>
        {items.length > 0 && prepare}
      </div>
      {contracts.isPending ? (
        <Skeleton className="h-24" />
      ) : contracts.isError ? (
        <LoadError
          message={t('retainers.contracts.loadError')}
          onRetry={() => contracts.refetch()}
          error={contracts.error}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ScrollTextIcon />}
          title={t('retainers.contracts.emptyTitle')}
          description={
            canPrepare ? t('retainers.contracts.emptyHint') : t('retainers.contracts.emptyReadOnly')
          }
          action={prepare}
        />
      ) : (
        <ol className="flex flex-col gap-3">
          {items.map((contract) => (
            <ContractCard
              key={contract.id}
              contract={contract}
              canManage={canManage}
              fallback={() => heading.current}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function ContractCard({
  contract,
  canManage,
  fallback,
}: {
  contract: RetainerContract;
  canManage: boolean;
  fallback: Fallback;
}) {
  const { t } = useTranslation();
  const retainerId = contract.retainerId;
  const sign = useSignContract(retainerId, contract.id);
  const voidContract = useVoidContract(retainerId, contract.id);
  const issued = contract.status === 'issued' || contract.status === 'signed';
  return (
    <li
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      data-testid="contract"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold" dir="auto">
              {contractName(t, contract)}
            </h3>
            <Badge tone={CONTRACT_STATUS_TONES[contract.status]}>
              {t(`retainers.contracts.statuses.${contract.status}`)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{contractCoverage(t, contract)}</p>
          <ContractDates contract={contract} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            render={
              <Link
                to="/retainers/$retainerId/contracts/$contractId"
                params={{ retainerId, contractId: contract.id }}
              />
            }
          >
            <FileTextIcon />
            {contract.status === 'draft'
              ? t('retainers.contracts.openDraft')
              : t('retainers.contracts.open')}
          </Button>
          {issued && <ContractPdf contract={contract} />}
          {canManage && contract.status === 'draft' && (
            <IssueContractDialog
              retainerId={retainerId}
              contractId={contract.id}
              size="sm"
              fallback={fallback}
            />
          )}
          {canManage && issued && (
            <>
              <SignedCopyDialog
                title={t('retainers.contracts.signedTitle', { name: contractName(t, contract) })}
                replacing={!!contract.signed}
                onSign={(input) => sign.mutateAsync(input)}
              />
              <VoidDialog
                title={t('retainers.contracts.voidTitle', { name: contractName(t, contract) })}
                body={t('retainers.contracts.voidBody')}
                onVoid={(reason) => voidContract.mutateAsync({ reason })}
                fallback={fallback}
              />
            </>
          )}
        </div>
      </div>
      {issued && contract.changedSinceIssue && <ChangedSinceIssue />}
      {contract.annexes.length > 0 && <AnnexList contract={contract} canManage={canManage} />}
    </li>
  );
}

/** Contract date, signed date and the void reason, as one muted line each. */
export function ContractDates({
  contract,
}: {
  contract: Pick<RetainerContract, 'contractDate' | 'signed' | 'voided'>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {t('retainers.contracts.dated', { date: formatCalendarDate(contract.contractDate) })}
        {contract.signed &&
          ` · ${t('retainers.contracts.signedOnDate', {
            date: formatCalendarDate(contract.signed.signedOn),
          })}`}
      </p>
      {contract.voided && (
        <p className="text-sm text-muted-foreground">
          {t('retainers.contracts.voidedBecause', { reason: contract.voided.reason })}
        </p>
      )}
    </>
  );
}

/** K9: nothing changes an issued contract by itself; the page says when it no longer matches. */
export function ChangedSinceIssue() {
  const { t } = useTranslation();
  return (
    <Callout
      tone="warning"
      icon={<TriangleAlertIcon />}
      title={t('retainers.contracts.changedTitle')}
      description={t('retainers.contracts.changedBody')}
    />
  );
}

function Preparing({ text }: { text: string }) {
  return (
    <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircleIcon
        aria-hidden="true"
        className="size-4 animate-spin motion-reduce:animate-none"
      />
      {text}
    </span>
  );
}

/** The issued PDF: "being prepared" until it exists, "render again" after a failure. */
export function ContractPdf({
  contract,
}: {
  contract: Pick<RetainerContract, 'id' | 'retainerId' | 'pdf'>;
}) {
  const { t } = useTranslation();
  const render = useRenderContractPdf(contract.retainerId, contract.id);
  return (
    <PdfState
      state={contract.pdf?.state ?? null}
      href={contractPdfUrl(contract.retainerId, contract.id)}
      pending={render.isPending}
      onRender={async () => {
        try {
          await render.mutateAsync();
        } catch (error) {
          toast.add({ title: errorMessage(t, error), type: 'error' });
        }
      }}
    />
  );
}

function PdfState({
  state,
  href,
  pending,
  onRender,
}: {
  state: 'pending' | 'ready' | 'failed' | null;
  href: string;
  pending: boolean;
  onRender: () => void;
}) {
  const { t } = useTranslation();
  if (state === 'ready') {
    return (
      <Button variant="outline" size="sm" render={<a href={href} target="_blank" rel="noopener" />}>
        <DownloadIcon />
        {t('retainers.contracts.pdf')}
      </Button>
    );
  }
  if (state === 'failed') {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Badge tone="danger">{t('retainers.contracts.pdfFailed')}</Badge>
        <Button variant="outline" size="sm" disabled={pending} onClick={onRender}>
          <RefreshCwIcon />
          {t('retainers.contracts.renderAgain')}
        </Button>
      </span>
    );
  }
  return <Preparing text={t('retainers.contracts.pdfPreparing')} />;
}

/** K10: a contract's annexes, oldest first, with their PDFs, signed copies and void. */
export function AnnexList({
  contract,
  canManage,
}: {
  contract: RetainerContract;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-bold">{t('retainers.contracts.annexes')}</h4>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {contract.annexes.map((annex) => (
          <AnnexRow key={annex.id} contract={contract} annex={annex} canManage={canManage} />
        ))}
      </ul>
    </div>
  );
}

function AnnexRow({
  contract,
  annex,
  canManage,
}: {
  contract: RetainerContract;
  annex: ContractAnnex;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const sign = useSignAnnex(contract.retainerId, contract.id);
  const voidAnnex = useVoidAnnex(contract.retainerId, contract.id);
  const render = useRenderAnnexPdf(contract.retainerId, contract.id);
  const live = annex.status !== 'void';
  const name = t('retainers.contracts.annexName', { annex: formatNumber(annex.annexNumber) });
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-2" data-testid="annex">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{name}</span>
          <Badge tone={CONTRACT_STATUS_TONES[annex.status]}>
            {t(`retainers.contracts.statuses.${annex.status}`)}
          </Badge>
        </div>
        <span className="text-sm text-muted-foreground">
          {t('retainers.contracts.annexOf', {
            amendment: formatNumber(annex.amendment.number),
            date: formatCalendarDate(annex.annexDate),
          })}
          {annex.signed &&
            ` · ${t('retainers.contracts.signedOnDate', {
              date: formatCalendarDate(annex.signed.signedOn),
            })}`}
        </span>
        {annex.voided && (
          <span className="text-sm text-muted-foreground">
            {t('retainers.contracts.voidedBecause', { reason: annex.voided.reason })}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {live && (
          <PdfState
            state={annex.pdf?.state ?? null}
            href={annexPdfUrl(contract.retainerId, contract.id, annex.id)}
            pending={render.isPending}
            onRender={async () => {
              try {
                await render.mutateAsync(annex.id);
              } catch (error) {
                toast.add({ title: errorMessage(t, error), type: 'error' });
              }
            }}
          />
        )}
        {canManage && live && (
          <>
            <SignedCopyDialog
              title={t('retainers.contracts.signedTitle', { name })}
              replacing={!!annex.signed}
              onSign={(input) => sign.mutateAsync({ annexId: annex.id, ...input })}
            />
            <VoidDialog
              title={t('retainers.contracts.voidTitle', { name })}
              body={t('retainers.contracts.voidAnnexBody')}
              onVoid={(reason) => voidAnnex.mutateAsync({ annexId: annex.id, reason })}
            />
          </>
        )}
      </div>
    </li>
  );
}
