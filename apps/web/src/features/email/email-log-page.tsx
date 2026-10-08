import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  EMAIL_AUDIENCES,
  EMAIL_KINDS,
  EMAIL_STATUSES,
  type EmailAudience,
  type EmailKind,
  type EmailLogItem,
  type EmailStatus,
} from '@vertex-hub/contracts';
import {
  Button,
  EmptyState,
  Field,
  FieldLabel,
  Input,
  PageHeader,
  Pagination,
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
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import { FilterXIcon, MailIcon, SearchIcon, SendIcon } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, formatNumber } from '../../lib/format';
import {
  ALL,
  dayParam,
  listParam,
  oneOfParam,
  pageParam,
  textParam,
} from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { useSearchText } from '../../lib/use-search-text';
import { emailListQuery, useSendTestEmail } from './email.queries';
import { EmailRecipients, EmailStatusBadge } from './email-history';

export interface EmailLogSearch {
  status?: EmailStatus[];
  audience?: EmailAudience;
  kind?: EmailKind;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
}

const PAGE_SIZE = 30;

export function parseEmailLogSearch(search: Record<string, unknown>): EmailLogSearch {
  return {
    status: listParam(EMAIL_STATUSES, search.status),
    audience: oneOfParam(EMAIL_AUDIENCES, search.audience),
    kind: oneOfParam(EMAIL_KINDS, search.kind),
    from: dayParam(search.from),
    to: dayParam(search.to),
    search: textParam(search.search, 200),
    page: pageParam(search.page),
  };
}

/** F14 email screen 6: the outbox for administrators, with a test email (rules 24–26). */
export function EmailLogPage({ search }: { search: EmailLogSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate({ from: '/emails' });
  const sendTest = useSendTestEmail();
  const page = search.page ?? 1;
  const emails = useQuery(
    emailListQuery({
      status: search.status,
      audience: search.audience,
      kind: search.kind ? [search.kind] : undefined,
      from: search.from,
      to: search.to,
      search: search.search,
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  usePageInRange(
    page,
    emails.data?.total,
    PAGE_SIZE,
    useCallback(
      (next: number | undefined) =>
        navigate({ search: (previous) => ({ ...previous, page: next }), replace: true }),
      [navigate],
    ),
  );
  const setFilter = useCallback(
    (next: Partial<EmailLogSearch>) =>
      navigate({
        search: (previous) => ({ ...previous, ...next, page: undefined }),
        replace: true,
      }),
    [navigate],
  );

  async function test() {
    try {
      await sendTest.mutateAsync();
      toast.add({ title: t('email.log.testQueued'), type: 'success' });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  return (
    <>
      <PageHeader
        title={t('email.log.title')}
        description={t('email.log.subtitle')}
        actions={
          can(me, 'users.manage') && (
            <Button
              variant="outline"
              disabled={sendTest.isPending}
              focusableWhenDisabled
              onClick={test}
            >
              <SendIcon />
              {t('email.log.test')}
            </Button>
          )
        }
      />
      <Filters search={search} onChange={setFilter} />
      {emails.isPending ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          {['a', 'b', 'c', 'd', 'e'].map((row) => (
            <Skeleton key={row} className="h-8" />
          ))}
        </div>
      ) : emails.isError ? (
        <LoadError message={t('email.log.loadError')} onRetry={() => emails.refetch()} />
      ) : emails.data.items.length === 0 ? (
        <EmptyState
          icon={<MailIcon />}
          title={t('email.log.emptyTitle')}
          description={t('email.log.emptyHint')}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <EmailTable emails={emails.data.items} />
          <Pagination
            page={page}
            pageCount={Math.ceil(emails.data.total / PAGE_SIZE)}
            onPageChange={(next) =>
              navigate({ search: (previous) => ({ ...previous, page: next }) })
            }
            summary={t('common.pageSummary', {
              from: formatNumber((page - 1) * PAGE_SIZE + 1),
              to: formatNumber((page - 1) * PAGE_SIZE + emails.data.items.length),
              total: formatNumber(emails.data.total),
            })}
            previousLabel={t('common.previous')}
            nextLabel={t('common.next')}
          />
        </div>
      )}
    </>
  );
}

function Filters({
  search,
  onChange,
}: {
  search: EmailLogSearch;
  onChange: (next: Partial<EmailLogSearch>) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useSearchText(search.search, onChange);
  const searchRef = useRef<HTMLInputElement>(null);
  const audienceItems = [
    { value: ALL, label: t('email.log.allAudiences') },
    ...EMAIL_AUDIENCES.map((audience) => ({
      value: audience,
      label: t(`email.audiences.${audience}`),
    })),
  ];
  const kindItems = [
    { value: ALL, label: t('email.log.allKinds') },
    ...EMAIL_KINDS.map((kind) => ({ value: kind, label: t(`email.kinds.${kind}`) })),
  ];
  const filtered = Object.entries(search).some(([key, value]) => key !== 'page' && !!value);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchRef}
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('email.log.search')}
            aria-label={t('email.log.search')}
            className="ps-9"
          />
        </div>
        <ToggleGroup
          multiple
          aria-label={t('email.log.status')}
          value={search.status ?? []}
          onValueChange={(next) =>
            onChange({ status: next.length > 0 ? (next as EmailStatus[]) : undefined })
          }
        >
          {EMAIL_STATUSES.map((status) => (
            <ToggleGroupItem key={status} value={status}>
              {t(`email.statuses.${status}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto] xl:items-end">
        <FilterSelect
          label={t('email.log.audience')}
          items={audienceItems}
          value={search.audience ?? ALL}
          onChange={(value) =>
            onChange({ audience: value === ALL ? undefined : (value as EmailAudience) })
          }
        />
        <FilterSelect
          label={t('email.log.kind')}
          items={kindItems}
          value={search.kind ?? ALL}
          onChange={(value) => onChange({ kind: value === ALL ? undefined : (value as EmailKind) })}
        />
        <Field>
          <FieldLabel>{t('email.log.from')}</FieldLabel>
          <Input
            type="date"
            dir="ltr"
            value={search.from ?? ''}
            max={search.to}
            onChange={(event) => onChange({ from: event.target.value || undefined })}
          />
        </Field>
        <Field>
          <FieldLabel>{t('email.log.to')}</FieldLabel>
          <Input
            type="date"
            dir="ltr"
            value={search.to ?? ''}
            min={search.from}
            onChange={(event) => onChange({ to: event.target.value || undefined })}
          />
        </Field>
        <Button
          variant="ghost"
          disabled={!filtered}
          focusableWhenDisabled
          onClick={() => {
            onChange({
              status: undefined,
              audience: undefined,
              kind: undefined,
              from: undefined,
              to: undefined,
              search: undefined,
            });
            // The button turns off: the search field is where filtering starts again.
            searchRef.current?.focus();
          }}
        >
          <FilterXIcon />
          {t('email.log.clear')}
        </Button>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select items={items} value={value} onValueChange={(next) => onChange(next ?? ALL)}>
        <SelectTrigger className="min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function EmailTable({ emails }: { emails: EmailLogItem[] }) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('email.log.columns.time')}</TableHead>
          <TableHead>{t('email.log.columns.kind')}</TableHead>
          <TableHead>{t('email.log.columns.recipients')}</TableHead>
          <TableHead className="hidden xl:table-cell">{t('email.log.columns.subject')}</TableHead>
          <TableHead>{t('email.log.columns.status')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {emails.map((email) => (
          <TableRow key={email.id}>
            <TableCell className="min-w-36 whitespace-normal">
              {formatDateTime(email.createdAt)}
            </TableCell>
            <TableCell>
              <span className="flex flex-col items-start">
                {t(`email.kinds.${email.kind}`)}
                <RecordLink email={email} />
              </span>
            </TableCell>
            <TableCell className="whitespace-normal">
              <span className="flex flex-col">
                <span>
                  <EmailRecipients email={email} />
                </span>
                <bdi dir="ltr" className="text-end text-xs text-muted-foreground">
                  {email.to.map((address) => address.email).join(', ')}
                </bdi>
                {/* Below `xl` the subject has no column of its own, so the status keeps its room. */}
                <span className="mt-1 max-w-64 truncate text-xs xl:hidden" dir="auto">
                  {email.subject}
                </span>
              </span>
            </TableCell>
            <TableCell
              className="hidden max-w-56 truncate xl:table-cell"
              dir="auto"
              title={email.subject}
            >
              {email.subject}
            </TableCell>
            <TableCell className="whitespace-normal">
              <span className="flex max-w-56 min-w-24 flex-col items-start gap-1">
                <EmailStatusBadge status={email.status} />
                <span className="text-xs text-muted-foreground">
                  {t('email.log.attempts', { n: formatNumber(email.attempts) })}
                </span>
                {email.error && (
                  <span className="text-xs text-destructive-text" dir="auto">
                    {email.error}
                  </span>
                )}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * The document a client email was sent from, under its kind; statements, reports and notices open
 * the client. Staff emails have none.
 */
function RecordLink({ email }: { email: EmailLogItem }) {
  const { t } = useTranslation();
  const { record, clientId } = email;
  const className = 'text-xs font-medium hover:underline';
  const label = t('email.log.open');
  if (record?.type === 'quote') {
    return (
      <Link to="/quotes/$quoteId" params={{ quoteId: record.id }} className={className}>
        {label}
      </Link>
    );
  }
  if (record?.type === 'invoice') {
    return (
      <Link to="/invoices/$invoiceId" params={{ invoiceId: record.id }} className={className}>
        {label}
      </Link>
    );
  }
  if (record?.type === 'approval_request') {
    return (
      <Link
        to="/approvals/requests/$requestId"
        params={{ requestId: record.id }}
        className={className}
      >
        {label}
      </Link>
    );
  }
  if (!clientId) return null;
  if (email.kind === 'client_report') {
    return (
      <Link to="/clients/$clientId/report" params={{ clientId }} className={className}>
        {label}
      </Link>
    );
  }
  const ads = email.kind === 'client_ad_receipt' || email.kind === 'client_ad_budget_low';
  return (
    <Link
      to="/clients/$clientId"
      params={{ clientId }}
      search={{ tab: ads ? 'ads' : 'invoices' }}
      className={className}
    >
      {label}
    </Link>
  );
}
