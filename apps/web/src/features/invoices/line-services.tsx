import { useQuery } from '@tanstack/react-query';
import type { InvoiceDetail, InvoiceLine } from '@vertex-hub/contracts';
import { Badge, Field, FieldDescription, FieldLabel, toast } from '@vertex-hub/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { serviceListQuery } from '../catalog/catalog.queries';
import { ChoiceSelect } from '../quotes/choice-select';
import { FormDialog } from '../quotes/quote-dialogs';
import { useSetInvoiceServices } from './invoices.queries';

const NO_SERVICE = 'none';

/**
 * F15 rule 21: the catalog service a line bills, for revenue by service; never printed. Offers the
 * non-archived services, and keeps the line's own service offered after it was archived (rule 22).
 */
export function LineServiceField({
  value,
  onChange,
  current,
  disabled,
}: {
  value: string | null;
  onChange: (serviceId: string | null) => void;
  /** The service stored on the line, archived ones included. */
  current: InvoiceLine['service'];
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const items = useServiceChoices(current);
  return (
    <Field>
      <FieldLabel id={id} render={<span />}>
        {t('invoices.editor.service')}
      </FieldLabel>
      <ChoiceSelect
        labelledBy={id}
        items={items}
        value={value ?? NO_SERVICE}
        onChange={(next) => onChange(next === NO_SERVICE ? null : next)}
        disabled={disabled}
      />
      <FieldDescription>{t('invoices.editor.serviceHint')}</FieldDescription>
    </Field>
  );
}

function useServiceChoices(current: InvoiceLine['service']) {
  const { t } = useTranslation();
  const services = useQuery(serviceListQuery({ pageSize: 100 }));
  const items = [
    { value: NO_SERVICE, label: t('invoices.editor.noService') },
    ...(services.data?.items ?? []).map((service) => ({ value: service.id, label: service.name })),
  ];
  if (current && !items.some((item) => item.value === current.id)) {
    items.push({
      value: current.id,
      label: current.archived
        ? t('invoices.services.archivedName', { name: current.name })
        : current.name,
    });
  }
  return items;
}

/** The line's service on the issued invoice; "—" without one. */
export function LineService({ service }: { service: InvoiceLine['service'] }) {
  const { t } = useTranslation();
  if (!service) return <span className="text-muted-foreground">{t('common.none')}</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {service.name}
      {service.archived && <Badge tone="neutral">{t('invoices.services.archived')}</Badge>}
    </span>
  );
}

/**
 * F15 rule 22: invoice managers set or clear the services of an issued, non-void invoice's lines.
 * Nothing else on the invoice changes and its PDF is not rendered again.
 */
export function ServicesDialog({
  invoice,
  open,
  onClose,
}: {
  invoice: InvoiceDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const save = useSetInvoiceServices(invoice.id);
  const stored = () => new Map(invoice.lines.map((line) => [line.id, line.service?.id ?? null]));
  const [values, setValues] = useState(stored);
  const [failure, setFailure] = useState<string | null>(null);

  function close() {
    setValues(stored());
    setFailure(null);
    onClose();
  }

  async function submit(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    setFailure(null);
    try {
      await save.mutateAsync({
        lines: invoice.lines.map((line) => ({
          lineId: line.id,
          serviceId: values.get(line.id) ?? null,
        })),
      });
      toast.add({ title: t('invoices.services.done'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <FormDialog
      open={open}
      onClose={close}
      submitting={save.isPending}
      title={t('invoices.services.title', { number: invoice.displayNumber ?? '' })}
      description={t('invoices.services.hint')}
      action={t('invoices.services.confirm')}
      failure={failure}
      onSubmit={submit}
    >
      <ol className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
        {invoice.lines.map((line, index) => (
          <li key={line.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <span className="text-sm font-medium">
              {t('invoices.editor.lineN', { n: formatNumber(index + 1) })}: {line.description}
            </span>
            <LineServiceField
              value={values.get(line.id) ?? null}
              current={line.service}
              onChange={(serviceId) =>
                setValues((previous) => new Map(previous).set(line.id, serviceId))
              }
            />
          </li>
        ))}
      </ol>
    </FormDialog>
  );
}
