import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  CONTRACT_AGENCY_FIELDS,
  CONTRACT_CLIENT_FIELDS,
  type ContractMissingField,
  type ContractSnapshot,
  contractBodyParts,
  type RetainerContractDetail,
  unknownPlaceholders,
  updateContractSchema,
} from '@vertex-hub/contracts';
import {
  CONTRACT_TEXT,
  contractArticleHeading,
  contractDeliverableName,
  contractFeesCaption,
  contractTermLines,
} from '@vertex-hub/messages';
import {
  Badge,
  Button,
  Callout,
  Field,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@vertex-hub/ui';
import {
  ArrowRightIcon,
  BanIcon,
  DownloadIcon,
  FileTextIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Controller, type UseFormReturn, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { LoadError } from '../../components/load-error';
import { UnsavedChangesGuard } from '../../components/unsaved-changes-guard';
import { ApiError } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, formatNumber, formatPeriod } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { clientQuery } from '../clients/clients.queries';
import { useFileItemActions } from '../files/file-dialogs';
import { FileItemCard } from '../files/file-item-card';
import { fileItemsQuery } from '../files/files.queries';
import {
  type ArticlesFormValues,
  type ArticleValues,
  ContractArticlesEditor,
} from './contract-articles-editor';
import {
  contractName,
  IssueContractDialog,
  missingFieldName,
  SignedCopyDialog,
  VoidDialog,
} from './contract-dialogs';
import {
  AnnexList,
  ChangedSinceIssue,
  CONTRACT_STATUS_TONES,
  ContractDates,
  ContractPdf,
  contractCoverage,
} from './contracts-section';
import {
  contractPdfUrl,
  retainerContractQuery,
  retainerQuery,
  useDiscardContract,
  useRenderContractPdf,
  useSignContract,
  useUpdateContract,
  useVoidContract,
} from './retainers.queries';

/**
 * F05C screen 6: a contract as it will print. A draft is edited by contract managers (date,
 * signatory, articles), previewed and issued; an issued contract is read-only with its PDF,
 * signed copy, annexes and "Void".
 */
export function ContractPage({
  retainerId,
  contractId,
}: {
  retainerId: string;
  contractId: string;
}) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const retainer = useQuery(retainerQuery(retainerId));
  const contract = useQuery(retainerContractQuery(retainerId, contractId));
  const data = contract.data;
  const editable = !!data && data.status === 'draft' && data.canManage;
  const issued = data?.status === 'issued' || data?.status === 'signed';

  return (
    <>
      <div>
        <Button
          variant="ghost"
          size="sm"
          render={
            <Link
              to="/retainers/$retainerId"
              params={{ retainerId }}
              search={{ tab: 'contract' }}
            />
          }
        >
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {retainer.data
            ? t('retainers.contracts.backTo', { name: retainer.data.name })
            : t('retainers.contracts.backToRetainer')}
        </Button>
      </div>
      <PageHeader
        headingRef={heading}
        title={data ? contractName(t, data) : t('retainers.contracts.pageTitle')}
        description={
          data && (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={CONTRACT_STATUS_TONES[data.status]}>
                {t(`retainers.contracts.statuses.${data.status}`)}
              </Badge>
              {retainer.data && `${retainer.data.client.name} · ${retainer.data.name} · `}
              {contractCoverage(t, data)}
            </span>
          )
        }
        actions={
          data &&
          issued && (
            <div className="flex flex-wrap items-center gap-2">
              <ContractPdf contract={data} />
              {data.canManage && <IssuedActions contract={data} fallback={heading} />}
            </div>
          )
        }
      />
      {contract.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      ) : contract.isError ? (
        <LoadError
          message={t('retainers.contracts.loadError')}
          onRetry={() => contract.refetch()}
          error={contract.error}
        />
      ) : editable ? (
        <DraftEditor contract={contract.data} clientId={retainer.data?.client.id ?? null} />
      ) : (
        <IssuedView contract={contract.data} />
      )}
    </>
  );
}

function IssuedActions({
  contract,
  fallback,
}: {
  contract: RetainerContractDetail;
  fallback: React.RefObject<HTMLHeadingElement | null>;
}) {
  const { t } = useTranslation();
  const sign = useSignContract(contract.retainerId, contract.id);
  const voidContract = useVoidContract(contract.retainerId, contract.id);
  return (
    <>
      <SignedCopyDialog
        size="md"
        title={t('retainers.contracts.signedTitle', { name: contractName(t, contract) })}
        replacing={!!contract.signed}
        onSign={(input) => sign.mutateAsync(input)}
      />
      <VoidDialog
        size="md"
        title={t('retainers.contracts.voidTitle', { name: contractName(t, contract) })}
        body={t('retainers.contracts.voidBody')}
        onVoid={(reason) => voidContract.mutateAsync({ reason })}
        fallback={() => fallback.current}
      />
    </>
  );
}

// Draft

interface DraftValues {
  contractDate: string;
  signatoryContactId: string | null;
  articles: ArticleValues[];
}

const draftValues = (contract: RetainerContractDetail): DraftValues => ({
  contractDate: contract.contractDate,
  signatoryContactId: contract.signatoryContact?.id ?? null,
  articles: contract.articles.map(({ id, title, body }) => ({ id, title, body })),
});

function DraftEditor({
  contract,
  clientId,
}: {
  contract: RetainerContractDetail;
  clientId: string | null;
}) {
  const { t } = useTranslation();
  const ids = { date: useId(), signatory: useId() };
  const update = useUpdateContract(contract.retainerId, contract.id);
  const [failure, setFailure] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<ReadonlySet<number>>(new Set());
  const form = useForm<DraftValues>({
    resolver: standardSchemaResolver(updateContractSchema) as never,
    resetOptions: { keepDirtyValues: true },
    values: draftValues(contract),
  });
  const { isDirty, isSubmitting, errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    // The API refuses unknown placeholders too; flagging them here names the articles.
    const flagged = new Set(
      values.articles.flatMap((article, index) =>
        unknownPlaceholders(article.body).length > 0 ? [index] : [],
      ),
    );
    setUnknown(flagged);
    if (flagged.size > 0) return;
    try {
      // The saved draft, with the ids of new articles, becomes the form's clean state.
      const saved = await update.mutateAsync(values);
      form.reset(draftValues(saved), { keepDirtyValues: false });
      toast.add({ title: t('retainers.contracts.saved'), type: 'success' });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'UNKNOWN_CONTACT') {
        form.setError('signatoryContactId', { message: errorMessage(t, error) });
        form.setFocus('signatoryContactId');
      } else {
        setFailure(errorMessage(t, error));
      }
    }
  });

  return (
    <div className="flex flex-col gap-6">
      <UnsavedChangesGuard dirty={isDirty} />
      <DraftActions contract={contract} dirty={isDirty} />
      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <FormSection
          title={t('retainers.contracts.details')}
          hint={t('retainers.contracts.detailsHint')}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field invalid={!!errors.contractDate}>
              <FieldLabel htmlFor={ids.date}>{t('retainers.contracts.contractDate')}</FieldLabel>
              <Input id={ids.date} type="date" dir="ltr" {...form.register('contractDate')} />
              <FieldError match={!!errors.contractDate}>
                {t('retainers.contracts.errors.date')}
              </FieldError>
            </Field>
            <SignatoryField
              form={form}
              clientId={clientId}
              contract={contract}
              id={ids.signatory}
            />
          </div>
        </FormSection>
        <FormSection
          title={t('retainers.contracts.articles')}
          hint={t('retainers.contracts.articlesHint')}
        >
          <ContractArticlesEditor
            // The editor reads and writes `articles` only, which both forms share.
            form={form as unknown as UseFormReturn<ArticlesFormValues>}
            readOnly={false}
            unknown={unknown}
          />
        </FormSection>
        {failure && <FormAlert>{failure}</FormAlert>}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {isDirty && (
            <p className="me-auto text-sm text-muted-foreground">{t('quotes.builder.unsaved')}</p>
          )}
          {/* Focusable while disabled, so saving does not drop the focus. */}
          <Button type="submit" disabled={!isDirty || isSubmitting} focusableWhenDisabled>
            {isSubmitting ? t('common.saving') : t('retainers.contracts.save')}
          </Button>
        </div>
      </form>
      <Parties contract={contract} links={clientId} />
      <Blocks content={contract.content} />
    </div>
  );
}

/** The client's contacts; a chosen contact archived since (edge case 11) stays shown. */
function SignatoryField({
  form,
  clientId,
  contract,
  id,
}: {
  form: UseFormReturn<DraftValues>;
  clientId: string | null;
  contract: RetainerContractDetail;
  id: string;
}) {
  const { t } = useTranslation();
  const client = useQuery({ ...clientQuery(clientId ?? ''), enabled: !!clientId });
  const contacts = client.data?.contacts ?? [];
  const chosen = contract.signatoryContact;
  const items = contacts.map((contact) => ({
    value: contact.id,
    label: contact.jobTitle ? `${contact.name} · ${contact.jobTitle}` : contact.name,
  }));
  if (chosen && !contacts.some((contact) => contact.id === chosen.id)) {
    items.push({
      value: chosen.id,
      label: t('retainers.contracts.archivedContact', { name: chosen.name }),
    });
  }
  const error = form.formState.errors.signatoryContactId;
  return (
    <Field invalid={!!error}>
      <FieldLabel htmlFor={id}>{t('retainers.contracts.signatory')}</FieldLabel>
      <Controller
        control={form.control}
        name="signatoryContactId"
        render={({ field }) => (
          <Select
            items={items}
            value={field.value}
            onValueChange={(value: string | null) => field.onChange(value)}
          >
            <SelectTrigger id={id} onBlur={field.onBlur} ref={field.ref}>
              <SelectValue placeholder={t('retainers.contracts.signatoryPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <FieldError match={!!error}>{error?.message}</FieldError>
    </Field>
  );
}

/** Preview PDF, Issue and Discard for the stored draft; changes are saved first. */
function DraftActions({ contract, dirty }: { contract: RetainerContractDetail; dirty: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const render = useRenderContractPdf(contract.retainerId, contract.id);
  const discard = useDiscardContract(contract.retainerId, contract.id);
  const [discarding, setDiscarding] = useState(false);
  const preview = contract.draftPdf;
  const required = contract.missing.filter((field) => field.required);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <FileTextIcon aria-hidden="true" className="size-5 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium">{t('retainers.contracts.previewTitle')}</span>
          <span className="text-sm text-muted-foreground">
            {dirty
              ? t('retainers.contracts.saveFirst')
              : preview?.state === 'ready' && preview.renderedAt
                ? t('retainers.contracts.previewRendered', {
                    when: formatDateTime(preview.renderedAt),
                  })
                : t('retainers.contracts.previewHint')}
          </span>
        </div>
        {preview?.state === 'pending' && (
          <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            {t('retainers.contracts.previewPreparing')}
          </span>
        )}
        {preview?.state === 'failed' && (
          <Badge tone="danger">{t('retainers.contracts.pdfFailed')}</Badge>
        )}
        {preview?.state === 'ready' && (
          <>
            {preview.outdated && (
              <Badge tone="warning">{t('retainers.contracts.previewOutdated')}</Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              render={
                <a
                  href={contractPdfUrl(contract.retainerId, contract.id, true)}
                  target="_blank"
                  rel="noopener"
                />
              }
            >
              <DownloadIcon />
              {t('retainers.contracts.openPreview')}
            </Button>
          </>
        )}
        {preview?.state !== 'pending' && (
          <Button
            variant="outline"
            size="sm"
            disabled={dirty || render.isPending}
            focusableWhenDisabled
            onClick={async () => {
              try {
                await render.mutateAsync();
              } catch (error) {
                toast.add({ title: errorMessage(t, error), type: 'error' });
              }
            }}
          >
            <RefreshCwIcon />
            {t('retainers.contracts.preview')}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        {required.length > 0 && (
          <p className="me-auto text-sm text-destructive-text">
            {t('retainers.contracts.cannotIssue', {
              fields: required.map((field) => missingFieldName(t, field)).join('، '),
            })}
          </p>
        )}
        <Button variant="outline" onClick={() => setDiscarding(true)}>
          <Trash2Icon />
          {t('retainers.contracts.discard')}
        </Button>
        <IssueContractDialog
          retainerId={contract.retainerId}
          contractId={contract.id}
          disabled={dirty}
        />
      </div>
      <ConfirmDialog
        open={discarding}
        onClose={() => setDiscarding(false)}
        title={t('retainers.contracts.discardTitle')}
        body={t('retainers.contracts.discardBody')}
        action={t('retainers.contracts.discard')}
        destructive
        pending={discard.isPending}
        onConfirm={async () => {
          await discard.mutateAsync();
          toast.add({ title: t('retainers.contracts.discarded'), type: 'success' });
          await navigate({
            to: '/retainers/$retainerId',
            params: { retainerId: contract.retainerId },
            search: { tab: 'contract' },
          });
        }}
      />
    </div>
  );
}

// What prints

/** The client fields a contact holds; the others are the client's (billing details). */
const CONTACT_FIELDS = new Set([
  'signatoryName',
  'fatherName',
  'nationalId',
  'phone',
  'email',
  'title',
]);

/**
 * K6: the two party tables as they print. On a draft, empty fields are flagged (required ones
 * block the issue) with a link to where they are filled in.
 */
function Parties({
  contract,
  links,
}: {
  contract: RetainerContractDetail;
  /** The client's id on a draft: the client and contact fields link to the client's tabs. */
  links?: string | null;
}) {
  const { t } = useTranslation();
  const { agency, client } = contract.content;
  const missing = new Map(
    contract.missing.map((field) => [`${field.party}.${field.field}`, field] as const),
  );
  const agencyMissing = contract.missing.some((field) => field.party === 'agency');
  const clientMissing = contract.missing.filter((field) => field.party === 'client');
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">{t('retainers.contracts.partiesTitle')}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <PartyTable
          title={t('retainers.contracts.parties.agency')}
          rows={CONTRACT_AGENCY_FIELDS.map((field) => ({
            key: field,
            label: t(`retainers.contractSettings.fields.${field}`),
            value: agency[field],
            missing: missing.get(`agency.${field}`),
          }))}
          fix={
            links !== undefined &&
            agencyMissing && (
              <Link to="/settings/contracts" className="text-sm font-medium underline">
                {t('retainers.contracts.fixSettings')}
              </Link>
            )
          }
        />
        <PartyTable
          title={t('retainers.contracts.parties.client')}
          rows={CONTRACT_CLIENT_FIELDS.map((field) => ({
            key: field,
            label: t(`retainers.contracts.clientFields.${field}`),
            value: field === 'nationalId' ? client.nationalId : client[field],
            missing: missing.get(`client.${field}`),
          }))}
          fix={
            links &&
            clientMissing.length > 0 && (
              <span className="flex flex-wrap gap-3">
                {clientMissing.some((field) => CONTACT_FIELDS.has(field.field)) && (
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: links }}
                    search={{ tab: 'contacts' }}
                    className="text-sm font-medium underline"
                  >
                    {t('retainers.contracts.fixContact')}
                  </Link>
                )}
                {clientMissing.some((field) => !CONTACT_FIELDS.has(field.field)) && (
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: links }}
                    search={{ tab: 'invoices' }}
                    className="text-sm font-medium underline"
                  >
                    {t('retainers.contracts.fixClient')}
                  </Link>
                )}
              </span>
            )
          }
        />
      </div>
      {contract.content.slogan && (
        <p className="text-center font-medium" dir="auto">
          {contract.content.slogan}
        </p>
      )}
    </section>
  );
}

function PartyTable({
  title,
  rows,
  fix,
}: {
  title: string;
  rows: {
    key: string;
    label: string;
    /** Undefined: hidden from this user (the national ID without access). */
    value: string | undefined;
    missing: ContractMissingField | undefined;
  }[];
  fix?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">{title}</h3>
        {fix}
      </div>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
        {rows.map((row) => (
          <div key={row.key} className="contents" data-testid={`party-${row.key}`}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              {row.value === undefined ? (
                <span className="text-muted-foreground">{t('retainers.contracts.hidden')}</span>
              ) : row.value ? (
                <span dir="auto">{row.value}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
              {row.missing && (
                <Badge tone={row.missing.required ? 'danger' : 'warning'}>
                  {row.missing.required
                    ? t('retainers.contracts.requiredField')
                    : t('retainers.contracts.emptyField')}
                </Badge>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** K7: what the blocks print, read-only, as the PDF shows them. */
function Blocks({ content }: { content: ContractSnapshot }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">{t('retainers.contracts.blocksTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('retainers.contracts.blocksHint')}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {(['services', 'term', 'fees'] as const).map((block) => (
          <div
            key={block}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
          >
            <h3 className="font-bold">{t(`retainers.contractSettings.placeholders.${block}`)}</h3>
            <BlockContent block={block} content={content} />
          </div>
        ))}
      </div>
    </section>
  );
}

function BlockContent({
  block,
  content,
}: {
  block: 'services' | 'term' | 'fees';
  content: ContractSnapshot;
}) {
  if (block === 'term') {
    return (
      <ul className="flex flex-col gap-1 text-sm">
        {contractTermLines(content.term).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    );
  }
  if (block === 'fees') {
    const { fees } = content;
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="font-medium">{contractFeesCaption(fees)}</p>
        {fees.schedule.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{CONTRACT_TEXT.fees.cycle}</TableHead>
                <TableHead>{CONTRACT_TEXT.fees.period}</TableHead>
                <TableHead className="text-end">{CONTRACT_TEXT.fees.amount}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fees.schedule.map((row) => (
                <TableRow key={row.cycle}>
                  <TableCell>{formatNumber(row.cycle)}</TableCell>
                  <TableCell>{formatPeriod(row.periodStart, row.periodEnd)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatMoney(row.amountMinor, fees.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    );
  }
  const { services } = content;
  return (
    <div className="flex flex-col gap-2 text-sm">
      {services.quote && (
        <>
          <p className="font-medium">
            {CONTRACT_TEXT.services.quote.replace('{{number}}', services.quote.displayNumber)}
          </p>
          <ul className="flex flex-col gap-1 ps-5">
            {services.quote.lines.map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a frozen snapshot never reorders
              <li key={index} className="list-disc">
                {line.name} × {formatNumber(line.quantity)}
                {line.items.length > 0 &&
                  ` (${line.items.map((item) => `${item.name} × ${formatNumber(item.quantity)}`).join('، ')})`}
              </li>
            ))}
          </ul>
        </>
      )}
      {services.deliverables.length === 0 ? (
        <p className="text-muted-foreground">{CONTRACT_TEXT.services.none}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{CONTRACT_TEXT.services.item}</TableHead>
              <TableHead className="text-end">{CONTRACT_TEXT.services.perCycle}</TableHead>
              <TableHead className="text-end">{CONTRACT_TEXT.services.revisions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.deliverables.map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a frozen snapshot never reorders
              <TableRow key={index}>
                <TableCell>{contractDeliverableName(line)}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatNumber(line.quantity)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {line.revisionLimit === null ? '—' : formatNumber(line.revisionLimit)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// Issued

/** An issued, signed or void contract: frozen content, annexes and documents (K3, K5, K10). */
function IssuedView({ contract }: { contract: RetainerContractDetail }) {
  const { t } = useTranslation();
  const issued = contract.status === 'issued' || contract.status === 'signed';
  return (
    <div className="flex flex-col gap-6">
      {contract.status === 'void' && (
        <Callout
          tone="neutral"
          icon={<BanIcon />}
          title={t('retainers.contracts.voidedTitle')}
          description={contract.voided?.reason}
        />
      )}
      {contract.status === 'draft' && (
        <Callout
          tone="info"
          icon={<FileTextIcon />}
          title={t('retainers.contracts.draftReadOnly')}
          description={t('retainers.contracts.draftReadOnlyBody')}
        />
      )}
      {issued && contract.changedSinceIssue && <ChangedSinceIssue />}
      <div className="flex flex-col gap-1">
        <ContractDates contract={contract} />
        {contract.issuedBy && contract.issuedAt && (
          <p className="text-sm text-muted-foreground">
            {t('retainers.contracts.issuedBy', {
              name: contract.issuedBy.name,
              at: formatDateTime(contract.issuedAt),
            })}
          </p>
        )}
        {contract.signatoryContact && (
          <p className="text-sm text-muted-foreground">
            {t('retainers.contracts.signatoryIs', { name: contract.signatoryContact.name })}
          </p>
        )}
      </div>
      {contract.annexes.length > 0 && (
        <AnnexList contract={contract} canManage={contract.canManage} />
      )}
      <Parties contract={contract} />
      <Articles content={contract.content} />
      {contract.status !== 'draft' && (
        // A ready PDF or a new signed copy adds a document: the list loads again.
        <ContractDocuments
          key={`${contract.pdf?.state}-${contract.signed?.fileItemId}`}
          contract={contract}
        />
      )}
    </div>
  );
}

/** The articles as they print, numbered by position, blocks in place (K6, K7). */
function Articles({ content }: { content: ContractSnapshot }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">{t('retainers.contracts.articles')}</h2>
      <p className="text-sm">{CONTRACT_TEXT.preamble}</p>
      <ol className="flex flex-col gap-4">
        {content.articles.map((article) => (
          <li
            key={article.number}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
          >
            <h3 className="font-bold">{contractArticleHeading(article)}</h3>
            {contractBodyParts(article.body).map((part, index) =>
              'block' in part ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: parts of one body never reorder
                <BlockContent key={index} block={part.block} content={content} />
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: parts of one body never reorder
                <p key={index} className="text-sm leading-relaxed">
                  {part.text}
                </p>
              ),
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The contract's documents (F10): its PDF and the signed copies, with their versions. */
function ContractDocuments({ contract }: { contract: RetainerContractDetail }) {
  const { t } = useTranslation();
  const owner = { type: 'retainer_contract' as const, id: contract.id };
  const files = useQuery(
    fileItemsQuery({ ownerType: owner.type, ownerId: owner.id, role: 'document' }),
  );
  const { actions, dialogs } = useFileItemActions(owner, { allowLink: false });
  const items = files.data?.items ?? [];
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">{t('retainers.contracts.documents')}</h2>
      {files.isPending ? (
        <Skeleton className="h-20" />
      ) : files.isError ? (
        <LoadError message={t('files.documents.loadError')} onRetry={() => files.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('retainers.contracts.noDocuments')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <FileItemCard key={item.id} item={item} actions={actions} />
          ))}
        </ul>
      )}
      {dialogs}
    </section>
  );
}
