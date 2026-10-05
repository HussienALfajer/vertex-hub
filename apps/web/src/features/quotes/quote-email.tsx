import { businessDate, type QuoteDetail } from '@vertex-hub/contracts';
import { Button } from '@vertex-hub/ui';
import { BellRingIcon, MailIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SendEmailDialog } from '../email/send-email-dialog';

/**
 * F14 email rule 18: a sent quote of a client is emailed by those who manage it, and reminded
 * while it is still valid, with the PDF of the sent version.
 */
export function QuoteEmailActions({ quote }: { quote: QuoteDetail }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<'quote' | 'reminder' | null>(null);
  // `canReject` on a sent quote: the caller manages its client (cosmetic; the API enforces it).
  if (
    quote.status !== 'sent' ||
    !quote.client ||
    !quote.validUntil ||
    !quote.permissions.canReject
  ) {
    return null;
  }
  const lines = (section: 'one_off' | 'monthly') =>
    quote.lines.some((line) => line.section === section);
  const facts = {
    quote: {
      number: quote.displayNumber,
      title: quote.title,
      currency: quote.currency,
      oneOffMinor: lines('one_off') ? quote.totals.oneOff.netMinor : null,
      monthlyMinor: lines('monthly') ? quote.totals.monthly.netMinor : null,
      validUntil: quote.validUntil,
    },
  };
  return (
    <>
      <Button variant="outline" onClick={() => setKind('quote')}>
        <MailIcon />
        {t('email.send.action')}
      </Button>
      {quote.validUntil >= businessDate() && (
        <Button variant="outline" onClick={() => setKind('reminder')}>
          <BellRingIcon />
          {t('quotes.email.reminder')}
        </Button>
      )}
      <SendEmailDialog
        open={kind !== null}
        onClose={() => setKind(null)}
        clientId={quote.client.id}
        target={{ type: 'quote', id: quote.id, kind: kind ?? 'quote' }}
        draft={{
          kind: kind === 'reminder' ? 'client_quote_reminder' : 'client_quote',
          data: facts,
        }}
        attachment={{
          fileName: `${quote.displayNumber}.pdf`,
          ready: quote.pdf?.state === 'ready',
        }}
      />
    </>
  );
}
