import type { AdWallet, WalletEntry } from '@vertex-hub/contracts';
import { Button } from '@vertex-hub/ui';
import { MailIcon, MailWarningIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SendEmailDialog } from '../email/send-email-dialog';

/** F14 email: fund holders, or the campaign managers covering the client, email the client. */
const canEmail = (wallet: AdWallet) =>
  wallet.permissions.canFund || wallet.permissions.canEditThreshold;

/** Rule 18: the receipt of a deposit that is not voided, with its PDF. */
export function DepositEmailButton({ wallet, entry }: { wallet: AdWallet; entry: WalletEntry }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { receiptNumber, receiptPdf } = entry;
  if (!canEmail(wallet) || entry.kind !== 'deposit' || entry.voided) return null;
  if (!receiptNumber || !receiptPdf) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('campaigns.email.receiptOf', { number: receiptNumber })}
        onClick={() => setOpen(true)}
      >
        <MailIcon />
      </Button>
      <SendEmailDialog
        open={open}
        onClose={() => setOpen(false)}
        clientId={wallet.client.id}
        target={{ type: 'ad_receipt', id: entry.id }}
        draft={{
          kind: 'client_ad_receipt',
          data: {
            receipt: {
              number: receiptNumber,
              occurredOn: entry.occurredOn,
              amount: { amountMinor: entry.amountMinor, currency: entry.currency },
            },
          },
        }}
        attachment={{ fileName: `${receiptNumber}.pdf`, ready: receiptPdf.state === 'ready' }}
      />
    </>
  );
}

/** Rule 18: the low balance notice, while the wallet is below its threshold (F12 rule 20). */
export function BudgetLowEmailButton({ wallet }: { wallet: AdWallet }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!canEmail(wallet) || !wallet.low || wallet.lowBalanceThresholdMinor === null) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <MailWarningIcon />
        {t('campaigns.email.budgetLow')}
      </Button>
      <SendEmailDialog
        open={open}
        onClose={() => setOpen(false)}
        clientId={wallet.client.id}
        target={{ type: 'ad_budget', clientId: wallet.client.id }}
        draft={{
          kind: 'client_ad_budget_low',
          data: {
            balanceMinor: wallet.balanceMinor,
            thresholdMinor: wallet.lowBalanceThresholdMinor,
          },
        }}
        attachment={null}
      />
    </>
  );
}
