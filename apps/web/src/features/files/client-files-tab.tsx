import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type ClientDetailResponse,
  FILE_TYPES,
  type FileDocument,
  type FileLibraryEntry,
  type FileType,
} from '@vertex-hub/contracts';
import {
  Button,
  EmptyState,
  Input,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
} from '@vertex-hub/ui';
import { FileCheckIcon, FileTextIcon, HardDriveIcon, SearchIcon, UploadIcon } from 'lucide-react';
import { type ReactNode, useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
import { canAll, useMe } from '../../lib/auth';
import {
  businessDay,
  formatCalendarDate,
  formatFileSize,
  formatMonth,
  formatNumber,
} from '../../lib/format';
import { ALL } from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { useSearchText } from '../../lib/use-search-text';
import { AddFilesDialog, useFileItemActions } from './file-dialogs';
import { type FileItemActions, FileItemCard, OpenButton } from './file-item-card';
import { FileThumbnail, VersionBadge } from './file-parts';
import {
  clientDocumentsQuery,
  type FileOwnerRef,
  fileItemsQuery,
  fileLibraryQuery,
  fileUsageQuery,
} from './files.queries';
import { type FileLibrarySearch, recentMonths } from './library-search';

/*
 * The client profile's Files tab (spec F10, screen 4): the library of final deliverables with
 * its filters in the URL, the documents of the client, its projects and retainers, and the
 * storage usage line for scope-all holders.
 */

const PAGE_SIZE = 50;

/** How far back the month filter reaches. */
const MONTHS_BACK = 24;

export function ClientFilesTab({
  client,
  search,
  onSearchChange,
}: {
  client: ClientDetailResponse;
  search: FileLibrarySearch;
  onSearchChange: (next: FileLibrarySearch) => void;
}) {
  const me = useMe();
  const owner: FileOwnerRef = { type: 'client', id: client.id };
  const { actions, dialogs } = useFileItemActions(owner, { allowLink: true });
  return (
    <>
      {canAll(me, 'clients.manage') && <UsageLine clientId={client.id} />}
      <LibrarySection
        clientId={client.id}
        search={search}
        onSearchChange={onSearchChange}
        actions={actions}
      />
      <DocumentsSection clientId={client.id} actions={actions} />
      {dialogs}
    </>
  );
}

/** Rule 19: "This client uses 1.2 GB · all files 18.4 GB · 150 GB free". */
function UsageLine({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const usage = useQuery(fileUsageQuery(clientId));
  if (!usage.data) return null;
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <HardDriveIcon aria-hidden="true" className="size-4 shrink-0" />
      {t('files.usage', {
        client: formatFileSize(usage.data.clientBytes ?? 0),
        total: formatFileSize(usage.data.totalBytes),
        free: formatFileSize(usage.data.freeBytes),
      })}
    </p>
  );
}

function LibrarySection({
  clientId,
  search,
  onSearchChange,
  actions,
}: {
  clientId: string;
  search: FileLibrarySearch;
  onSearchChange: (next: FileLibrarySearch) => void;
  actions: FileItemActions;
}) {
  const { t } = useTranslation();
  const page = search.filePage ?? 1;
  const library = useQuery(
    fileLibraryQuery({
      clientId,
      type: search.fileType,
      month: search.fileMonth,
      q: search.fileQ,
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  const setFilter = useCallback(
    (next: FileLibrarySearch) => onSearchChange({ ...next, filePage: undefined }),
    [onSearchChange],
  );
  usePageInRange(
    page,
    library.data?.total,
    PAGE_SIZE,
    useCallback((next: number | undefined) => onSearchChange({ filePage: next }), [onSearchChange]),
  );
  const filtered = !!(search.fileType || search.fileMonth || search.fileQ);
  const entries = library.data?.items ?? [];
  const previewEntries = entries.map((entry) => ({ name: entry.itemName, version: entry.version }));

  return (
    <section className="flex flex-col gap-4">
      <TabHeader title={t('files.library.title')} description={t('files.library.hint')} />
      <LibraryFilters search={search} onChange={setFilter} />
      {library.isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <Skeleton className="aspect-4/3" />
          <Skeleton className="aspect-4/3" />
          <Skeleton className="aspect-4/3" />
        </div>
      ) : library.isError ? (
        <LoadError message={t('files.library.loadError')} onRetry={() => library.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<FileCheckIcon />}
          title={filtered ? t('files.library.noMatchTitle') : t('files.library.emptyTitle')}
          description={filtered ? t('files.library.noMatchHint') : t('files.library.emptyHint')}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {entries.map((entry, index) => (
              <LibraryTile
                key={entry.version.id}
                entry={entry}
                onPreview={() => actions.onPreview(previewEntries, index)}
              />
            ))}
          </ul>
          {library.data.total > PAGE_SIZE && (
            <Pagination
              page={page}
              pageCount={Math.ceil(library.data.total / PAGE_SIZE)}
              onPageChange={(next) => onSearchChange({ filePage: next > 1 ? next : undefined })}
              summary={t('common.pageSummary', {
                from: formatNumber((page - 1) * PAGE_SIZE + 1),
                to: formatNumber((page - 1) * PAGE_SIZE + entries.length),
                total: formatNumber(library.data.total),
              })}
              previousLabel={t('common.previous')}
              nextLabel={t('common.next')}
            />
          )}
        </div>
      )}
    </section>
  );
}

function LibraryFilters({
  search,
  onChange,
}: {
  search: FileLibrarySearch;
  onChange: (next: FileLibrarySearch) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useSearchText(
    search.fileQ,
    useCallback((next) => onChange({ fileQ: next.search }), [onChange]),
  );
  const types = [
    { value: ALL, label: t('files.library.allTypes') },
    ...FILE_TYPES.map((type) => ({ value: type, label: t(`files.types.${type}`) })),
  ];
  const months = [
    { value: ALL, label: t('files.library.allMonths') },
    ...recentMonths(businessDay(new Date()).slice(0, 7), MONTHS_BACK).map((month) => ({
      value: month,
      label: formatMonth(`${month}-01`),
    })),
  ];
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 md:flex-row md:items-center">
      <div className="relative flex-1">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('files.library.search')}
          aria-label={t('files.library.search')}
          className="ps-9"
        />
      </div>
      <FilterSelect
        label={t('files.library.type')}
        items={types}
        value={search.fileType ?? ALL}
        onChange={(value) =>
          onChange({ fileType: value === ALL ? undefined : (value as FileType) })
        }
      />
      <FilterSelect
        label={t('files.library.month')}
        items={months}
        value={search.fileMonth ?? ALL}
        onChange={(value) => onChange({ fileMonth: value === ALL ? undefined : value })}
      />
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
    <Select items={items} value={value} onValueChange={(next) => onChange(next ?? ALL)}>
      <SelectTrigger aria-label={label} className="md:w-44">
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
  );
}

/** A final file: its thumbnail, name, version, task and the day it became final. */
function LibraryTile({ entry, onPreview }: { entry: FileLibraryEntry; onPreview: () => void }) {
  const { t } = useTranslation();
  const { version } = entry;
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-2">
      <button
        type="button"
        className="rounded-md focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={t('files.previewNamed', { name: entry.itemName })}
        onClick={onPreview}
      >
        <FileThumbnail version={version} className="aspect-4/3 w-full" />
      </button>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium" dir="auto">
            {entry.itemName}
          </span>
          <VersionBadge number={version.number} />
        </div>
        <Link
          to="/tasks/$taskId"
          params={{ taskId: entry.task.id }}
          className="truncate text-xs hover:underline"
        >
          {entry.task.title}
        </Link>
        {version.finalMarkedAt && (
          <span className="text-xs text-muted-foreground">
            {t('files.library.finalOn', {
              date: formatCalendarDate(businessDay(version.finalMarkedAt)),
            })}
          </span>
        )}
      </div>
      <div className="flex justify-end">
        <OpenButton version={version} name={entry.itemName} />
      </div>
    </li>
  );
}

/**
 * Where a document belongs: the client itself, or one of its projects, retainers, quotes or
 * invoices.
 */
function DocumentOwner({ document }: { document: FileDocument }) {
  const { t } = useTranslation();
  const { owner } = document;
  const className = 'text-xs hover:underline';
  let link: ReactNode = (
    <span className="text-xs text-muted-foreground">{t('files.documents.ofClient')}</span>
  );
  if (owner.type === 'project') {
    link = (
      <Link
        to="/projects/$projectId"
        params={{ projectId: owner.id }}
        search={{ tab: 'documents' }}
        className={className}
      >
        {t('files.documents.ofProject', { name: owner.label })}
      </Link>
    );
  }
  if (owner.type === 'retainer') {
    link = (
      <Link
        to="/retainers/$retainerId"
        params={{ retainerId: owner.id }}
        search={{ tab: 'documents' }}
        className={className}
      >
        {t('files.documents.ofRetainer', { name: owner.label })}
      </Link>
    );
  }
  if (owner.type === 'quote') {
    // The quote page arrives with the quote screens (F04 PR 5); the PDF opens from the list.
    link = (
      <span className="text-xs text-muted-foreground">
        {t('files.documents.ofQuote', { name: owner.label })}
      </span>
    );
  }
  if (owner.type === 'invoice') {
    // The invoice page arrives with the invoice screens (F13 PR 6); the file opens from the list.
    link = (
      <span className="text-xs text-muted-foreground">
        {t('files.documents.ofInvoice', { name: owner.label })}
      </span>
    );
  }
  return link;
}

function DocumentsSection({ clientId, actions }: { clientId: string; actions: FileItemActions }) {
  const { t } = useTranslation();
  const showRemovedId = useId();
  const [page, setPage] = useState(1);
  const [showRemoved, setShowRemoved] = useState(false);
  const [adding, setAdding] = useState(false);
  const documents = useQuery(clientDocumentsQuery({ clientId, page, pageSize: PAGE_SIZE }));
  // The client's own documents carry its rights, and the removed ones for scope-all holders.
  const own = useQuery(
    fileItemsQuery({
      ownerType: 'client',
      ownerId: clientId,
      role: 'document',
      ...(showRemoved && { includeArchived: 'true' }),
    }),
  );
  usePageInRange(
    page,
    documents.data?.total,
    PAGE_SIZE,
    useCallback((next: number | undefined) => setPage(next ?? 1), []),
  );
  const rights = own.data?.rights;
  const ownItems = showRemoved ? (own.data?.items ?? []) : [];
  const removed = ownItems.filter((item) => item.archivedAt !== null);
  // With "Show removed", the client's own documents come with their removed versions (rule 8).
  const withHistory = new Map(ownItems.map((item) => [item.id, item]));
  const items = documents.data?.items ?? [];

  const upload = rights?.canManageDocuments && (
    <Button size="sm" onClick={() => setAdding(true)}>
      <UploadIcon />
      {t('files.documents.upload')}
    </Button>
  );

  return (
    <section className="flex flex-col gap-4">
      <TabHeader
        title={t('files.documents.title')}
        description={t('files.documents.hint.client')}
        action={
          <div className="flex flex-wrap items-center gap-3">
            {rights?.canSeeRemoved && (
              <label htmlFor={showRemovedId} className="flex items-center gap-2 text-sm">
                <Switch id={showRemovedId} checked={showRemoved} onCheckedChange={setShowRemoved} />
                {t('files.showRemoved')}
              </label>
            )}
            {items.length > 0 && upload}
          </div>
        }
      />
      {documents.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : documents.isError ? (
        <LoadError message={t('files.documents.loadError')} onRetry={() => documents.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FileTextIcon />}
          title={t('files.documents.emptyTitle')}
          description={rights?.canManageDocuments ? t('files.documents.emptyHint') : undefined}
          action={upload}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-3">
            {items.map((document) => (
              <FileItemCard
                key={document.id}
                item={withHistory.get(document.id) ?? document}
                actions={actions}
                meta={<DocumentOwner document={document} />}
              />
            ))}
          </ul>
          {documents.data.total > PAGE_SIZE && (
            <Pagination
              page={page}
              pageCount={Math.ceil(documents.data.total / PAGE_SIZE)}
              onPageChange={setPage}
              summary={t('common.pageSummary', {
                from: formatNumber((page - 1) * PAGE_SIZE + 1),
                to: formatNumber((page - 1) * PAGE_SIZE + items.length),
                total: formatNumber(documents.data.total),
              })}
              previousLabel={t('common.previous')}
              nextLabel={t('common.next')}
            />
          )}
        </div>
      )}
      {showRemoved && removed.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold">{t('files.documents.removed')}</h3>
          <ul className="flex flex-col gap-3">
            {removed.map((item) => (
              <FileItemCard key={item.id} item={item} actions={actions} />
            ))}
          </ul>
        </div>
      )}
      {adding && (
        <AddFilesDialog
          owner={{ type: 'client', id: clientId }}
          fileRole="document"
          title={t('files.documents.uploadTitle')}
          description={t('files.documents.uploadBody')}
          withNote
          allowLink
          withConfidential={rights?.canSetConfidential}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  );
}
