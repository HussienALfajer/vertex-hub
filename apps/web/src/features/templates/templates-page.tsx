import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { TEMPLATE_KINDS, type TemplateKind, type TemplateListItem } from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  EmptyState,
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
} from '@vertex-hub/ui';
import { LayoutTemplateIcon, PlusIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { formatDate, formatNumber } from '../../lib/format';
import { ALL, flagParam, oneOfParam, pageParam, textParam } from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { useSearchText } from '../../lib/use-search-text';
import { DepartmentChips } from '../projects/project-badges';
import { TemplateKindBadge } from './template-badges';
import { templateListQuery } from './templates.queries';

export interface TemplatesSearch {
  search?: string;
  kind?: TemplateKind;
  archived?: boolean;
  page?: number;
}

const PAGE_SIZE = 25;

/** Reads the list filters from the URL, dropping anything malformed. */
export function parseTemplatesSearch(search: Record<string, unknown>): TemplatesSearch {
  return {
    search: textParam(search.search, 100),
    kind: oneOfParam(TEMPLATE_KINDS, search.kind),
    archived: flagParam(search.archived),
    page: pageParam(search.page),
  };
}

export function TemplatesPage({ search }: { search: TemplatesSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const manager = can(me, 'templates.manage');
  const navigate = useNavigate({ from: '/templates/' });
  const page = search.page ?? 1;
  const archived = manager && !!search.archived;

  const templates = useQuery(
    templateListQuery({
      search: search.search,
      kind: search.kind,
      archived: archived ? 'true' : undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  usePageInRange(
    page,
    templates.data?.total,
    PAGE_SIZE,
    useCallback(
      (next: number | undefined) =>
        navigate({ search: (previous) => ({ ...previous, page: next }), replace: true }),
      [navigate],
    ),
  );

  const setFilter = useCallback(
    (next: Partial<TemplatesSearch>) =>
      navigate({
        search: (previous) => ({ ...previous, ...next, page: undefined }),
        replace: true,
      }),
    [navigate],
  );
  const filtered = !!(search.search || search.kind || archived);

  return (
    <>
      <PageHeader
        title={t('templates.title')}
        description={t('templates.subtitle')}
        actions={
          manager && (
            <Button render={<Link to="/templates/new" />}>
              <PlusIcon />
              {t('templates.newTemplate')}
            </Button>
          )
        }
      />

      <Filters search={search} manager={manager} onChange={setFilter} />

      {templates.isPending ? (
        <TableSkeleton />
      ) : templates.isError ? (
        <LoadError message={t('templates.loadError')} onRetry={() => templates.refetch()} />
      ) : templates.data.items.length === 0 ? (
        <EmptyState
          icon={<LayoutTemplateIcon />}
          title={filtered ? t('templates.noMatchesTitle') : t('templates.emptyTitle')}
          description={
            filtered ? t('templates.noMatchesHint') : manager ? t('templates.emptyHint') : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <TemplatesTable templates={templates.data.items} />
          <Pagination
            page={page}
            pageCount={Math.ceil(templates.data.total / PAGE_SIZE)}
            onPageChange={(next) =>
              navigate({ search: (previous) => ({ ...previous, page: next }) })
            }
            summary={t('common.pageSummary', {
              from: formatNumber((page - 1) * PAGE_SIZE + 1),
              to: formatNumber((page - 1) * PAGE_SIZE + templates.data.items.length),
              total: formatNumber(templates.data.total),
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
  manager,
  onChange,
}: {
  search: TemplatesSearch;
  manager: boolean;
  onChange: (next: Partial<TemplatesSearch>) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useSearchText(search.search, onChange);

  const kindItems = [
    { value: ALL, label: t('templates.allKinds') },
    ...TEMPLATE_KINDS.map((kind) => ({ value: kind, label: t(`templates.kinds.${kind}`) })),
  ];
  const stateItems = [
    { value: 'active', label: t('templates.activeOnly') },
    { value: 'archived', label: t('templates.archivedOnly') },
  ];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 md:flex-row md:flex-wrap md:items-center">
      {/* Keeps room to type; the selects wrap under it when the row is narrow. */}
      <div className="relative flex-1 md:min-w-64">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('templates.search')}
          aria-label={t('templates.search')}
          className="ps-9"
        />
      </div>
      <FilterSelect
        label={t('templates.kind')}
        items={kindItems}
        value={search.kind ?? ALL}
        onChange={(value) =>
          onChange({ kind: value === ALL ? undefined : (value as TemplateKind) })
        }
      />
      {manager && (
        <FilterSelect
          label={t('templates.state')}
          items={stateItems}
          value={search.archived ? 'archived' : 'active'}
          onChange={(value) => onChange({ archived: value === 'archived' ? true : undefined })}
        />
      )}
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

function TemplatesTable({ templates }: { templates: TemplateListItem[] }) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('templates.columns.name')}</TableHead>
          <TableHead>{t('templates.kind')}</TableHead>
          <TableHead className="text-end">{t('templates.columns.steps')}</TableHead>
          <TableHead>{t('templates.columns.departments')}</TableHead>
          <TableHead>{t('templates.columns.updatedAt')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {templates.map((template) => (
          <TableRow key={template.id}>
            <TableCell className="whitespace-normal">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/templates/$templateId"
                    params={{ templateId: template.id }}
                    className="font-medium outline-offset-4 hover:underline"
                  >
                    {template.name}
                  </Link>
                  {template.warningCount > 0 && (
                    <Badge tone="warning">
                      <TriangleAlertIcon aria-hidden="true" />
                      {t('templates.warningCount', {
                        n: formatNumber(template.warningCount),
                      })}
                    </Badge>
                  )}
                  {template.archivedAt && (
                    <Badge tone="outline">{t('templates.archivedBadge')}</Badge>
                  )}
                </span>
                {template.description && (
                  <span className="line-clamp-1 max-w-md text-sm text-muted-foreground">
                    {template.description}
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell>
              <TemplateKindBadge kind={template.kind} />
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {formatNumber(template.stepCount)}
            </TableCell>
            <TableCell className="whitespace-normal">
              <DepartmentChips codes={template.departments} max={3} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatDate(template.updatedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {['a', 'b', 'c', 'd'].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="ms-auto h-4 w-32" />
        </div>
      ))}
    </div>
  );
}
