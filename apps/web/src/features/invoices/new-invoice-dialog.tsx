import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CURRENCIES, type Currency } from '@vertex-hub/contracts';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
} from '@vertex-hub/ui';
import { type FormEvent, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { errorMessage } from '../../lib/errors';
import { focusFirstInvalid } from '../../lib/focus-first-invalid';
import { clientListQuery } from '../clients/clients.queries';
import { ChoiceSelect } from '../quotes/choice-select';
import { useCreateInvoice } from './invoices.queries';

/**
 * Spec screen 1: a manual draft for a client in a currency (rules 1 and 6), opened in the editor,
 * where billable items and free lines are added. From a client's profile the client is fixed.
 */
export function NewInvoiceDialog({
  open,
  onClose,
  clientId: fixedClientId,
}: {
  open: boolean;
  onClose: () => void;
  /** The client the invoice is for, when the dialog opens from its profile. */
  clientId?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ids = { client: useId(), currency: useId() };
  const create = useCreateInvoice();
  const [clientId, setClientId] = useState(fixedClientId ?? '');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [missingClient, setMissingClient] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Ended and paused clients can be invoiced; archived ones cannot (rule 1).
  const clients = useQuery({
    ...clientListQuery({ status: ['active', 'paused', 'ended'], pageSize: 100 }),
    enabled: open && !fixedClientId,
  });

  // Once it has faded out, so the fields do not change while it fades.
  function closed() {
    setFailure(null);
    setMissingClient(false);
    setClientId(fixedClientId ?? '');
    setCurrency('USD');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!clientId) {
      flushSync(() => setMissingClient(true));
      focusFirstInvalid(formRef.current);
      return;
    }
    try {
      const invoice = await create.mutateAsync({
        clientId,
        currency,
        projectId: null,
        retainerId: null,
        sources: [],
      });
      onClose();
      await navigate({ to: '/invoices/$invoiceId', params: { invoiceId: invoice.id } });
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  const clientItems = (clients.data?.items ?? []).map((item) => ({
    value: item.id,
    label: item.tradeName,
  }));
  const currencyItems = CURRENCIES.map((code) => ({
    value: code,
    label: t(`invoices.currencies.${code}`),
  }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onOpenChangeComplete={(next) => !next && closed()}
    >
      <DialogContent closeLabel={t('common.close')}>
        <form ref={formRef} className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('invoices.new.title')}</DialogTitle>
            <DialogDescription>{t('invoices.new.hint')}</DialogDescription>
          </DialogHeader>
          {!fixedClientId && (
            <Field invalid={missingClient}>
              <FieldLabel id={ids.client} render={<span />}>
                {t('invoices.new.client')}
              </FieldLabel>
              <ChoiceSelect
                labelledBy={ids.client}
                items={clientItems}
                value={clientId || null}
                placeholder={t('invoices.new.pickClient')}
                onChange={(next) => {
                  setClientId(next);
                  setMissingClient(false);
                }}
              />
              <FieldError match={missingClient}>{t('invoices.new.errors.client')}</FieldError>
            </Field>
          )}
          <Field>
            <FieldLabel id={ids.currency} render={<span />}>
              {t('invoices.new.currency')}
            </FieldLabel>
            <ChoiceSelect
              labelledBy={ids.currency}
              items={currencyItems}
              value={currency}
              onChange={(next) => setCurrency(next as Currency)}
            />
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t('common.saving') : t('invoices.new.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
