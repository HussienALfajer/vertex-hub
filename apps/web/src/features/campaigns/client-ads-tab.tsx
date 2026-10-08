import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  AD_CAMPAIGN_STATUSES,
  type AdWallet,
  type AdWalletEntryKind,
  type ClientDetailResponse,
  type MeResponse,
  type WalletEntry,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-hub/ui';
import {
  BanIcon,
  BanknoteArrowDownIcon,
  BanknoteArrowUpIcon,
  MegaphoneIcon,
  PencilIcon,
  PlusIcon,
  WalletIcon,
} from 'lucide-react';
import { type ReactNode, type RefObject, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
import { scopesOf } from '../../lib/auth';
import { formatCalendarDate } from '../../lib/format';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { EmailHistory } from '../email/email-history';
import { Money } from '../quotes/quote-badges';
import { Balance, LowBalanceBadge } from './campaign-badges';
import { CampaignDialog } from './campaign-dialog';
import { adWalletQuery, campaignListQuery } from './campaigns.queries';
import { CampaignsTable, TableSkeleton } from './campaigns-page';
import {
  DepositReceipt,
  ProofLink,
  ThresholdDialog,
  VoidEntryDialog,
  WalletEntryDialog,
} from './wallet-dialogs';
import { BudgetLowEmailButton, DepositEmailButton } from './wallet-email';

/** Campaign readers covering the client see its Ads tab (spec screen 4). */
export function hasCampaignAccess(me: MeResponse, accountManagerId: string): boolean {
  const scopes = scopesOf(me, 'campaigns.read');
  return (
    scopes.includes('all') || (scopes.includes('own_clients') && accountManagerId === me.user.id)
  );
}

/**
 * Spec screen 4: the client's ad-budget wallet with its ledger, and its campaigns. Fund holders
 * record deposits and refunds; campaign managers edit the threshold and add campaigns.
 */
export function ClientAdsTab({ client }: { client: ClientDetailResponse }) {
  const { t } = useTranslation();
  const wallet = useQuery(adWalletQuery(client.id));
  return (
    <div className="flex flex-col gap-6">
      {wallet.isPending ? (
        <div className="flex flex-col gap-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {['a', 'b', 'c', 'd', 'e'].map((key) => (
              <Skeleton key={key} className="h-24" />
            ))}
          </div>
          <TableSkeleton />
        </div>
      ) : wallet.isError ? (
        <LoadError
          message={t('campaigns.wallet.loadError')}
          onRetry={() => wallet.refetch()}
          error={wallet.error}
        />
      ) : (
        <>
          <WalletSection wallet={wallet.data} />
          <CampaignsSection
            client={client}
            canCreate={wallet.data.permissions.canEditThreshold && client.archivedAt === null}
          />
        </>
      )}
    </div>
  );
}

function WalletSection({ wallet }: { wallet: AdWallet }) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState<AdWalletEntryKind | null>(null);
  const [editingThreshold, setEditingThreshold] = useState(false);
  const [voiding, setVoiding] = useState<WalletEntry | null>(null);
  const { permissions } = wallet;
  // Where each dialog gives the focus back: the button that opened it; a voided entry loses its
  // "void" button, so the ledger's heading takes it.
  const depositButton = useRef<HTMLButtonElement>(null);
  const refundButton = useRef<HTMLButtonElement>(null);
  const thresholdButton = useRef<HTMLButtonElement>(null);
  const ledgerHeading = useRef<HTMLHeadingElement>(null);
  const shownKind = useShownWhileClosing(recording);

  return (
    <section className="flex flex-col gap-4">
      <TabHeader
        title={t('campaigns.wallet.title')}
        description={t('campaigns.wallet.hint')}
        action={
          (permissions.canDeposit || permissions.canFund || wallet.low) && (
            <div className="flex flex-wrap items-center gap-2">
              <BudgetLowEmailButton wallet={wallet} />
              {permissions.canFund && (
                <Button
                  ref={refundButton}
                  size="sm"
                  variant="outline"
                  onClick={() => setRecording('refund')}
                >
                  <BanknoteArrowUpIcon />
                  {t('campaigns.entry.refund')}
                </Button>
              )}
              {permissions.canDeposit && (
                <Button ref={depositButton} size="sm" onClick={() => setRecording('deposit')}>
                  <BanknoteArrowDownIcon />
                  {t('campaigns.entry.deposit')}
                </Button>
              )}
            </div>
          )
        }
      />
      <section
        aria-label={t('campaigns.wallet.totals')}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <Stat label={t('campaigns.wallet.deposited')}>
          <Money minor={wallet.depositedMinor} currency="USD" className="text-lg font-bold" />
        </Stat>
        <Stat label={t('campaigns.wallet.refunded')}>
          <Money minor={wallet.refundedMinor} currency="USD" className="text-lg font-bold" />
        </Stat>
        <Stat label={t('campaigns.wallet.spent')}>
          <Money minor={wallet.spentMinor} currency="USD" className="text-lg font-bold" />
        </Stat>
        <Stat label={t('campaigns.wallet.balance')} badge={wallet.low && <LowBalanceBadge />}>
          <span className="flex">
            <Balance minor={wallet.balanceMinor} className="text-lg font-bold" />
          </span>
        </Stat>
        <Stat
          label={t('campaigns.wallet.threshold')}
          badge={
            permissions.canEditThreshold && (
              <IconButton
                ref={thresholdButton}
                label={t('campaigns.threshold.edit')}
                onClick={() => setEditingThreshold(true)}
              >
                <PencilIcon />
              </IconButton>
            )
          }
        >
          {wallet.lowBalanceThresholdMinor === null ? (
            <span className="text-muted-foreground">{t('campaigns.wallet.thresholdOff')}</span>
          ) : (
            <Money minor={wallet.lowBalanceThresholdMinor} currency="USD" className="text-lg" />
          )}
        </Stat>
      </section>
      <Ledger
        wallet={wallet}
        headingRef={ledgerHeading}
        onVoid={permissions.canFund ? setVoiding : undefined}
      />
      <EmailHistory target={{ type: 'ad_wallet', clientId: wallet.client.id }} />

      <WalletEntryDialog
        wallet={wallet}
        open={recording !== null}
        kind={shownKind ?? 'deposit'}
        onClose={() => setRecording(null)}
        finalFocus={shownKind === 'refund' ? refundButton : depositButton}
      />
      {permissions.canEditThreshold && (
        <ThresholdDialog
          wallet={wallet}
          open={editingThreshold}
          onClose={() => setEditingThreshold(false)}
          finalFocus={thresholdButton}
        />
      )}
      <VoidEntryDialog
        clientId={wallet.client.id}
        entry={voiding}
        onClose={() => setVoiding(null)}
        finalFocus={ledgerHeading}
      />
    </section>
  );
}

function Stat({
  label,
  badge,
  children,
}: {
  label: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="gap-2 p-4">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h3 className="text-sm text-muted-foreground">{label}</h3>
        {badge}
      </div>
      {children}
    </Card>
  );
}

/** Rule 15: deposits, refunds and spend by date with the running balance; void entries struck. */
function Ledger({
  wallet,
  headingRef,
  onVoid,
}: {
  wallet: AdWallet;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onVoid?: (entry: WalletEntry) => void;
}) {
  const { t } = useTranslation();
  const entries = new Map(wallet.entries.map((entry) => [entry.id, entry]));
  if (wallet.ledger.length === 0) {
    return (
      <EmptyState
        icon={<WalletIcon />}
        title={t('campaigns.ledger.empty')}
        description={t('campaigns.ledger.emptyHint')}
      />
    );
  }
  return (
    <Card className="gap-4 p-6">
      <h3 ref={headingRef} tabIndex={-1} className="text-lg font-bold outline-none">
        {t('campaigns.ledger.heading')}
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('campaigns.ledger.date')}</TableHead>
            <TableHead>{t('campaigns.ledger.type')}</TableHead>
            <TableHead>{t('campaigns.ledger.description')}</TableHead>
            <TableHead className="text-end">{t('campaigns.ledger.amount')}</TableHead>
            <TableHead className="text-end">{t('campaigns.ledger.usd')}</TableHead>
            <TableHead className="text-end">{t('campaigns.ledger.balance')}</TableHead>
            <TableHead>{t('campaigns.ledger.documents')}</TableHead>
            {onVoid && (
              <TableHead>
                <span className="sr-only">{t('campaigns.ledger.actions')}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {wallet.ledger.map((row) => {
            const entry = entries.get(row.id);
            const sign = row.kind === 'deposit' ? '' : '−';
            return (
              <TableRow key={row.id} className={row.voided ? 'text-muted-foreground' : ''}>
                <TableCell>{formatCalendarDate(row.date)}</TableCell>
                <TableCell>
                  <span className="flex flex-col items-start gap-1">
                    <span>{t(`campaigns.ledger.kinds.${row.kind}`)}</span>
                    {row.voided && <Badge tone="outline">{t('campaigns.ledger.voided')}</Badge>}
                  </span>
                </TableCell>
                {/* Wide enough for a campaign name and its period on two lines. */}
                <TableCell className="min-w-56 whitespace-normal">
                  {row.spend ? (
                    <span className="flex flex-col">
                      <Link
                        to="/campaigns/$campaignId"
                        params={{ campaignId: row.spend.campaign.id }}
                        className="self-start hover:underline"
                      >
                        {row.spend.campaign.name}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {t('campaigns.dateRange', {
                          from: formatCalendarDate(row.spend.periodStart),
                          to: formatCalendarDate(row.spend.periodEnd),
                        })}
                      </span>
                    </span>
                  ) : (
                    <span className="flex flex-col">
                      {row.entry?.receiptNumber && (
                        <span dir="ltr" className="self-start whitespace-nowrap tabular-nums">
                          {row.entry.receiptNumber}
                        </span>
                      )}
                      {entry && (
                        <span className="text-xs text-muted-foreground">
                          {[t(`invoices.methods.${entry.method}`), entry.reference]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                      {entry?.voided && (
                        <span className="text-xs">
                          {t('campaigns.ledger.voidedBy', {
                            name: entry.voided.by.name,
                            reason: entry.voided.reason,
                          })}
                        </span>
                      )}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-end">
                  {row.entry ? (
                    <span className={row.voided ? 'line-through' : undefined}>
                      <Money minor={row.entry.amountMinor} currency={row.entry.currency} />
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t('common.none')}</span>
                  )}
                </TableCell>
                <TableCell className="text-end">
                  <span dir="ltr" className={row.voided ? 'line-through' : undefined}>
                    {sign}
                    <Money minor={row.usdMinor} currency="USD" />
                  </span>
                </TableCell>
                <TableCell className="text-end font-medium">
                  <Money
                    minor={row.balanceMinor}
                    currency="USD"
                    className={row.balanceMinor < 0 ? 'text-destructive-text' : undefined}
                  />
                </TableCell>
                <TableCell>
                  {entry ? (
                    <span className="flex flex-wrap items-center gap-1">
                      <DepositReceipt clientId={wallet.client.id} entry={entry} />
                      <DepositEmailButton wallet={wallet} entry={entry} />
                      <ProofLink entry={entry} />
                    </span>
                  ) : null}
                </TableCell>
                {onVoid && (
                  <TableCell>
                    {entry && !entry.voided && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('campaigns.void.actionOf', {
                          entry: entry.receiptNumber ?? formatCalendarDate(entry.occurredOn),
                        })}
                        onClick={() => onVoid(entry)}
                      >
                        <BanIcon />
                        {t('campaigns.void.action')}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function CampaignsSection({
  client,
  canCreate,
}: {
  client: ClientDetailResponse;
  canCreate: boolean;
}) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const newButton = useRef<HTMLButtonElement>(null);
  const campaigns = useQuery(
    campaignListQuery({ clientId: client.id, status: [...AD_CAMPAIGN_STATUSES], pageSize: 100 }),
  );
  return (
    <section className="flex flex-col gap-4">
      <TabHeader
        title={t('campaigns.client.title')}
        action={
          canCreate && (
            <Button ref={newButton} size="sm" onClick={() => setCreating(true)}>
              <PlusIcon />
              {t('campaigns.new.action')}
            </Button>
          )
        }
      />
      {campaigns.isPending ? (
        <TableSkeleton />
      ) : campaigns.isError ? (
        <LoadError message={t('campaigns.loadError')} onRetry={() => campaigns.refetch()} />
      ) : campaigns.data.items.length === 0 ? (
        <EmptyState
          icon={<MegaphoneIcon />}
          title={t('campaigns.client.empty')}
          description={canCreate ? t('campaigns.client.emptyHint') : undefined}
        />
      ) : (
        <CampaignsTable campaigns={campaigns.data.items} showClient={false} />
      )}
      {canCreate && (
        <CampaignDialog
          open={creating}
          onClose={() => setCreating(false)}
          clientId={client.id}
          finalFocus={newButton}
        />
      )}
    </section>
  );
}
