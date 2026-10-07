import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  isOpenLeadStage,
  LEAD_FOLLOW_UP_FILTERS,
  LEAD_LIMITS,
  LEAD_SORTS,
  LEAD_SOURCES,
  LEAD_STAGES,
  type Lead,
  type LeadBoard,
  type LeadFollowUpFilter,
  type LeadSource,
  type LeadStage,
  manualLeadMoveRefusal,
  OPEN_LEAD_STAGES,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  MultiCombobox,
  PageHeader,
  Pagination,
  Skeleton,
  type SortDirection,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSortHead,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  CircleCheckBigIcon,
  CircleXIcon,
  EllipsisIcon,
  FileTextIcon,
  FilterXIcon,
  KanbanIcon,
  ListIcon,
  MoveIcon,
  PlusIcon,
  SearchIcon,
  TargetIcon,
} from 'lucide-react';
import {
  type ComponentProps,
  type DragEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { LoadError } from '../../components/load-error';
import { can, canAll, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatNumber } from '../../lib/format';
import { ALL, idParam, listParam, oneOfParam, pageParam, textParam } from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { useReturnFocus } from '../../lib/use-return-focus';
import { useSearchText } from '../../lib/use-search-text';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { ChoiceSelect } from '../quotes/choice-select';
import { Budget, FollowUpDate, LeadStageBadge, SourceMark } from './lead-badges';
import { LeadDialog } from './lead-dialog';
import { ConvertDialog, type LeadRef, LoseDialog } from './lead-dialogs';
import {
  type LeadBoardFilters,
  type LeadListFilters,
  leadBoardQuery,
  leadListQuery,
  leadOwnersQuery,
  useArchiveLead,
  useMoveLead,
  useRestoreLead,
} from './leads.queries';

type LeadSort = (typeof LEAD_SORTS)[number];

type LeadView = 'board' | 'list';

export interface LeadsSearch {
  /** Unset means the view the user chose last (local storage), else the board. */
  view?: LeadView;
  search?: string;
  /** `all` or a user id; unset means the default: the user's own for account managers. */
  owner?: string;
  source?: LeadSource[];
  followUp?: LeadFollowUpFilter;
  /** The list's stages; unset means the open ones. */
  stage?: LeadStage[];
  archived?: true;
  sort?: LeadSort;
  order?: SortDirection;
  page?: number;
}

const PAGE_SIZE = 20;

/** Reads the Leads page filters from the URL, dropping anything malformed. */
export function parseLeadsSearch(search: Record<string, unknown>): LeadsSearch {
  return {
    view: oneOfParam(['board', 'list'] as const, search.view),
    search: textParam(search.search, 100),
    owner: search.owner === ALL ? ALL : idParam(search.owner),
    source: listParam(LEAD_SOURCES, search.source),
    followUp: oneOfParam(LEAD_FOLLOW_UP_FILTERS, search.followUp),
    stage: listParam(LEAD_STAGES, search.stage),
    archived: search.archived === true || search.archived === 'true' ? true : undefined,
    sort: LEAD_SORTS.find((sort) => sort !== 'nextFollowUpOn' && sort === search.sort),
    order: search.order === 'desc' ? 'desc' : undefined,
    page: pageParam(search.page),
  };
}

/** The view is remembered per user on this device (screen 1). */
const viewKey = (userId: string) => `vertex-hub.leads.view.${userId}`;

function storedView(userId: string): LeadView {
  try {
    return localStorage.getItem(viewKey(userId)) === 'list' ? 'list' : 'board';
  } catch {
    return 'board';
  }
}

/** Spec screen 1: the pipeline as a board (default) or a list, with the same filters. */
export function LeadsPage({ search }: { search: LeadsSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate({ from: '/leads/' });
  const manager = can(me, 'leads.manage');
  const scopeAll = canAll(me, 'leads.manage');
  const archived = scopeAll && search.archived === true;
  // Archived leads have no stage column: they are listed only.
  const view: LeadView = archived ? 'list' : (search.view ?? storedView(me.user.id));
  const [creating, setCreating] = useState(false);
  // Where the focus goes when an archived or restored row leaves the list.
  const archivedToggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!search.view) return;
    try {
      localStorage.setItem(viewKey(me.user.id), search.view);
    } catch {
      // Storage is a convenience: the URL still holds the view.
    }
  }, [search.view, me.user.id]);

  // Account managers start with their own leads, everyone else with all of them.
  const isAccountManager = me.roles.includes('account_manager');
  const ownerId =
    search.owner === ALL
      ? undefined
      : (search.owner ?? (isAccountManager && !scopeAll ? me.user.id : undefined));

  const setFilter = useCallback(
    (next: Partial<LeadsSearch>) =>
      navigate({
        search: (previous) => ({ ...previous, ...next, page: undefined }),
        replace: true,
      }),
    [navigate],
  );
  const filtered =
    !!search.search ||
    !!search.source ||
    !!search.followUp ||
    !!search.stage ||
    (search.owner !== undefined && search.owner !== ALL);
  const filters = {
    search: search.search,
    ownerId,
    source: search.source,
    followUp: search.followUp,
  };
  const newLead = manager && (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon />
      {t('leads.newLead')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('leads.title')}
        description={t('leads.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!archived && (
              <ToggleGroup
                aria-label={t('leads.view.label')}
                value={[view]}
                onValueChange={(next: LeadView[]) => {
                  if (next[0]) setFilter({ view: next[0] });
                }}
              >
                <ToggleGroupItem value="board">
                  <KanbanIcon />
                  {t('leads.view.board')}
                </ToggleGroupItem>
                <ToggleGroupItem value="list">
                  <ListIcon />
                  {t('leads.view.list')}
                </ToggleGroupItem>
              </ToggleGroup>
            )}
            {newLead}
          </div>
        }
      />
      <Filters
        search={search}
        view={view}
        archived={archived}
        scopeAll={scopeAll}
        filtered={filtered}
        onChange={setFilter}
        archivedToggle={archivedToggle}
      />
      {view === 'board' ? (
        <BoardView filters={filters} filtered={filtered} newLead={newLead} />
      ) : (
        <ListView
          search={search}
          filters={filters}
          archived={archived}
          filtered={filtered}
          newLead={newLead}
          rowGone={archivedToggle}
        />
      )}
      {manager && <LeadDialog open={creating} onClose={() => setCreating(false)} />}
    </>
  );
}

function Filters({
  search,
  view,
  archived,
  scopeAll,
  filtered,
  onChange,
  archivedToggle,
}: {
  search: LeadsSearch;
  view: LeadView;
  archived: boolean;
  scopeAll: boolean;
  filtered: boolean;
  onChange: (next: Partial<LeadsSearch>) => void;
  archivedToggle: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const ids = { owner: useId(), source: useId(), followUp: useId(), stage: useId() };
  // Owners come from the lead managers' list; readers without it pick All or Mine.
  const owners = useQuery({ ...leadOwnersQuery, enabled: can(me, 'leads.manage') });
  const [text, setText] = useSearchText(search.search, onChange);
  const isAccountManager = me.roles.includes('account_manager') && !scopeAll;

  const ownerItems = [
    { value: ALL, label: t('leads.filters.allOwners') },
    { value: me.user.id, label: t('leads.filters.mine') },
    ...(owners.data?.items ?? [])
      .filter((owner) => owner.id !== me.user.id)
      .map((owner) => ({ value: owner.id, label: owner.name })),
  ];
  const sourceItems = LEAD_SOURCES.map((code) => ({ code, name: t(`leads.sources.${code}`) }));
  const stageItems = LEAD_STAGES.map((code) => ({ code, name: t(`leads.stages.${code}`) }));
  const followUpItems = [
    { value: ALL, label: t('leads.filters.anyFollowUp') },
    ...LEAD_FOLLOW_UP_FILTERS.map((value) => ({
      value,
      label: t(`leads.filters.followUps.${value}`),
    })),
  ];
  const ownerValue = search.owner ?? (isAccountManager ? me.user.id : ALL);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="relative">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('leads.search')}
          aria-label={t('leads.search')}
          className="ps-9"
        />
      </div>
      <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ChoiceSelect
          label={t('leads.filters.owner')}
          items={ownerItems}
          value={ownerValue}
          onChange={(value) => onChange({ owner: value })}
        />
        <MultiCombobox
          id={ids.source}
          aria-label={t('leads.filters.source')}
          items={sourceItems}
          value={sourceItems.filter((item) => search.source?.includes(item.code))}
          onValueChange={(next) =>
            onChange({ source: next.length > 0 ? next.map((item) => item.code) : undefined })
          }
          itemToLabel={(item) => item.name}
          itemToKey={(item) => item.code}
          placeholder={t('leads.filters.anySource')}
          emptyLabel={t('common.noMatches')}
          removeLabel={(label) => t('common.remove', { label })}
        />
        <ChoiceSelect
          label={t('leads.filters.followUp')}
          items={followUpItems}
          value={search.followUp ?? ALL}
          onChange={(value) =>
            onChange({ followUp: value === ALL ? undefined : (value as LeadFollowUpFilter) })
          }
        />
        {view === 'list' && !archived && (
          <MultiCombobox
            id={ids.stage}
            aria-label={t('leads.filters.stage')}
            items={stageItems}
            value={stageItems.filter((item) =>
              (search.stage ?? OPEN_LEAD_STAGES).includes(item.code as never),
            )}
            onValueChange={(next) =>
              onChange({ stage: next.length > 0 ? next.map((item) => item.code) : undefined })
            }
            itemToLabel={(item) => item.name}
            itemToKey={(item) => item.code}
            placeholder={t('leads.filters.openStages')}
            emptyLabel={t('common.noMatches')}
            removeLabel={(label) => t('common.remove', { label })}
          />
        )}
      </div>
      {(scopeAll || filtered) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {scopeAll && (
            <Button
              ref={archivedToggle}
              variant={archived ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={archived}
              onClick={() => onChange({ archived: archived ? undefined : true })}
            >
              <ArchiveIcon />
              {t('leads.filters.archived')}
            </Button>
          )}
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({
                  search: undefined,
                  owner: undefined,
                  source: undefined,
                  followUp: undefined,
                  stage: undefined,
                })
              }
            >
              <FilterXIcon />
              {t('leads.filters.clear')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyLeads({ filtered, newLead }: { filtered: boolean; newLead: ReactNode }) {
  const { t } = useTranslation();
  return filtered ? (
    <EmptyState
      icon={<SearchIcon />}
      title={t('leads.emptyFilteredTitle')}
      description={t('leads.emptyFilteredHint')}
    />
  ) : (
    <EmptyState
      icon={<TargetIcon />}
      title={t('leads.emptyTitle')}
      description={t('leads.emptyHint')}
      action={newLead}
    />
  );
}

// Board

/** What dropping a lead on a stage does (rule 5): a move, a dialog, or nothing. */
type DropAction = 'move' | 'convert' | 'lose';

function dropAction(lead: Lead, to: LeadStage, manager: boolean): DropAction | null {
  if (!manager || lead.archivedAt || !isOpenLeadStage(lead.stage) || lead.stage === to) return null;
  if (to === 'won') return 'convert';
  if (to === 'lost') return 'lose';
  // A sent quote is checked by the API: the card snaps back with the reason.
  return manualLeadMoveRefusal(lead.stage, to, false) === null ? 'move' : null;
}

interface Pending {
  action: 'convert' | 'lose';
  lead: LeadRef;
}

function BoardView({
  filters,
  filtered,
  newLead,
}: {
  filters: LeadBoardFilters;
  filtered: boolean;
  newLead: ReactNode;
}) {
  const { t } = useTranslation();
  const board = useQuery(leadBoardQuery(filters));
  if (board.isPending) return <BoardSkeleton />;
  if (board.isError) {
    return <LoadError message={t('leads.loadError')} onRetry={() => board.refetch()} />;
  }
  if (board.data.columns.every((column) => column.count === 0)) {
    return <EmptyLeads filtered={filtered} newLead={newLead} />;
  }
  return <Board board={board.data} filters={filters} />;
}

function Board({ board, filters }: { board: LeadBoard; filters: LeadBoardFilters }) {
  const { t } = useTranslation();
  const me = useMe();
  const manager = can(me, 'leads.manage');
  const move = useMoveLead();
  const [dragged, setDragged] = useState<Lead | null>(null);
  const [over, setOver] = useState<LeadStage | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const shown = useShownWhileClosing(pending);
  const [phoneStage, setPhoneStage] = useState<LeadStage>('new');
  const root = useRef<HTMLDivElement>(null);
  // A moved card mounts again in its new column: the focus goes there once the board shows it.
  const [moved, setMoved] = useState<{ id: string; stage: LeadStage } | null>(null);

  /** The shown copy of a card's move button, or its name once closed (won, lost). */
  const cardControl = useCallback((id: string, stage?: LeadStage): HTMLElement | null => {
    for (const card of root.current?.querySelectorAll<HTMLElement>(`[data-lead="${id}"]`) ?? []) {
      // Phones show the stage tabs, wider screens the columns: one copy is hidden.
      if (card.offsetParent === null || (stage && card.dataset.stage !== stage)) continue;
      return card.querySelector<HTMLElement>('[data-move-menu]') ?? card.querySelector('a');
    }
    return null;
  }, []);

  useEffect(() => {
    if (!moved || !board) return;
    // The refreshed board renders a moment after the move resolves: wait for the card there.
    const control = cardControl(moved.id, moved.stage);
    if (!control) return;
    control.focus();
    setMoved(null);
  }, [moved, board, cardControl]);

  async function act(lead: Lead, to: LeadStage) {
    const action = dropAction(lead, to, manager);
    if (!action) {
      toast.add({ title: t('leads.board.notAllowed'), type: 'error' });
      return;
    }
    if (action !== 'move') {
      setPending({ action, lead });
      return;
    }
    try {
      await move.mutateAsync({ id: lead.id, stage: to as 'new' | 'contacted' | 'meeting' });
      toast.add({
        title: t('leads.board.moved', { name: lead.displayName, stage: t(`leads.stages.${to}`) }),
        type: 'success',
      });
      setMoved({ id: lead.id, stage: to });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
      // Snapped back: the card's button takes the focus where it was.
      setMoved({ id: lead.id, stage: lead.stage });
    }
  }

  function startDrag(event: DragEvent, lead: Lead) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', lead.id);
    setDragged(lead);
  }

  function endDrag() {
    setDragged(null);
    setOver(null);
  }

  function drop(stage: LeadStage) {
    const current = dragged;
    endDrag();
    if (current && current.stage !== stage) void act(current, stage);
  }

  const listSearch = (stage: LeadStage): LeadsSearch => ({
    view: 'list',
    stage: [stage],
    search: filters.search,
    owner: filters.ownerId ?? ALL,
    source: filters.source && [filters.source].flat(),
    followUp: filters.followUp,
  });

  const columnFooter = (column: LeadBoard['columns'][number]) => (
    <>
      {column.truncated && (
        <Button
          variant="ghost"
          size="sm"
          className="m-2 mt-0"
          render={<Link to="/leads" search={listSearch(column.stage)} />}
        >
          {t('leads.board.showInList', { n: formatNumber(column.count) })}
          <ArrowLeftIcon className="ltr:-scale-x-100" />
        </Button>
      )}
      {!isOpenLeadStage(column.stage) && (
        <p className="px-3 pb-3 text-xs text-muted-foreground">
          {t('leads.board.closedHint', { days: formatNumber(LEAD_LIMITS.boardClosedDays) })}
        </p>
      )}
    </>
  );

  return (
    <div ref={root} className="contents">
      {/* Phones: one stage at a time (screen 1). */}
      <Tabs
        className="md:hidden"
        value={phoneStage}
        onValueChange={(stage: LeadStage) => setPhoneStage(stage)}
      >
        <div className="-mx-4 overflow-x-auto px-4">
          <TabsList aria-label={t('leads.board.stages')}>
            {board.columns.map((column) => (
              <TabsTrigger key={column.stage} value={column.stage}>
                {t(`leads.stages.${column.stage}`)}
                <span className="text-muted-foreground tabular-nums">
                  {formatNumber(column.count)}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {board.columns.map((column) => (
          <TabsContent key={column.stage} value={column.stage}>
            {column.items.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('leads.board.emptyColumn')}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {column.items.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    manager={manager}
                    onMove={(to) => act(lead, to)}
                  />
                ))}
              </ul>
            )}
            {columnFooter(column)}
          </TabsContent>
        ))}
      </Tabs>

      <p className="sr-only">{t('leads.board.keyboardHint')}</p>
      <div className="relative hidden overflow-x-auto pb-2 md:block">
        <ol aria-label={t('leads.board.stages')} className="flex min-w-max items-start gap-3">
          {board.columns.map((column) => {
            const stage = column.stage;
            const source = dragged?.stage === stage;
            const allowed = !!dragged && !source && !!dropAction(dragged, stage, manager);
            return (
              <li
                key={stage}
                aria-label={t(`leads.stages.${stage}`)}
                data-stage={stage}
                data-drop={dragged && !source ? (allowed ? 'allowed' : 'refused') : undefined}
                onDragOver={(event) => {
                  if (!allowed) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setOver(stage);
                }}
                onDragLeave={() => setOver((current) => (current === stage ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  drop(stage);
                }}
                className={cn(
                  'flex w-72 flex-col rounded-lg border border-border bg-muted/40 transition-[opacity,border-color,background-color] duration-150 ease-out',
                  allowed && 'border-primary border-dashed',
                  over === stage && allowed && 'bg-primary/5',
                  dragged && !source && !allowed && 'opacity-50',
                )}
              >
                <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                  <LeadStageBadge stage={stage} />
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {formatNumber(column.count)}
                  </span>
                </div>
                {column.items.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {t('leads.board.emptyColumn')}
                  </p>
                ) : (
                  <ul className="flex max-h-[70dvh] flex-col gap-2 overflow-y-auto p-2">
                    {column.items.map((lead) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        manager={manager}
                        dragging={dragged?.id === lead.id}
                        onDragStart={(event) => startDrag(event, lead)}
                        onDragEnd={endDrag}
                        onMove={(to) => act(lead, to)}
                      />
                    ))}
                  </ul>
                )}
                {columnFooter(column)}
              </li>
            );
          })}
        </ol>
      </div>
      {shown && (
        <>
          <ConvertDialog
            lead={shown.lead}
            open={pending?.action === 'convert'}
            onClose={() => setPending(null)}
            finalFocus={() => cardControl(shown.lead.id)}
          />
          <LoseDialog
            lead={shown.lead}
            open={pending?.action === 'lose'}
            onClose={() => setPending(null)}
            finalFocus={() => cardControl(shown.lead.id)}
          />
        </>
      )}
    </div>
  );
}

function LeadCard({
  lead,
  manager,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  lead: Lead;
  manager: boolean;
  dragging?: boolean;
  onDragStart?: (event: DragEvent) => void;
  onDragEnd?: () => void;
  onMove: (to: LeadStage) => void;
}) {
  const { t } = useTranslation();
  const draggable = !!onDragStart && manager && isOpenLeadStage(lead.stage);
  const shown = lead.interests.slice(0, 2);
  const more = lead.interests.length - shown.length;
  return (
    <li
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      data-lead={lead.id}
      data-stage={lead.stage}
      className={cn(
        'flex flex-col gap-2 rounded-md border border-border bg-surface p-3',
        draggable && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-50',
      )}
    >
      <div className="flex items-start gap-2">
        <SourceMark source={lead.source} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Link
            to="/leads/$leadId"
            params={{ leadId: lead.id }}
            draggable={false}
            className="font-medium hover:underline"
          >
            {lead.displayName}
          </Link>
          {lead.companyName && (
            <span className="truncate text-xs text-muted-foreground">{lead.contactName}</span>
          )}
        </div>
        {manager && isOpenLeadStage(lead.stage) && <MoveMenu lead={lead} onMove={onMove} />}
      </div>
      {lead.interests.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {shown.map((name) => (
            <Badge key={name} tone="outline" className="max-w-full truncate">
              {name}
            </Badge>
          ))}
          {more > 0 && (
            <Badge tone="neutral" dir="ltr">
              {t('leads.card.more', { n: formatNumber(more) })}
            </Badge>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <Budget lead={lead} className="font-medium text-foreground" />
        <span>
          {t('leads.card.daysInStage', {
            count: lead.daysInStage,
            n: formatNumber(lead.daysInStage),
          })}
        </span>
        {lead.quoteCount > 0 && (
          <span className="flex items-center gap-1">
            <FileTextIcon aria-hidden="true" className="size-3.5" />
            {t('leads.card.quotes', { n: formatNumber(lead.quoteCount) })}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        {lead.client ? (
          <span className="truncate text-muted-foreground">{lead.client.name}</span>
        ) : (
          <FollowUpDate lead={lead} />
        )}
        <Tooltip>
          <TooltipTrigger render={<span className="flex" />}>
            <Avatar
              name={lead.owner.name}
              size="sm"
              tone={lead.owner.archived ? 'muted' : 'brand'}
            />
            <span className="sr-only">{t('leads.card.owner', { name: lead.owner.name })}</span>
          </TooltipTrigger>
          <TooltipContent>{lead.owner.name}</TooltipContent>
        </Tooltip>
      </div>
    </li>
  );
}

/** The keyboard and menu way to move a card (screen 1); same rules as dragging. */
function MoveMenu({ lead, onMove }: { lead: Lead; onMove: (to: LeadStage) => void }) {
  const { t } = useTranslation();
  const moves = (['new', 'contacted', 'meeting'] as const).filter(
    (to) => dropAction(lead, to, true) === 'move',
  );
  const label = t('leads.board.moveTo', { name: lead.displayName });
  // A chosen move owns the focus from then on: the board gives it to the card in its new column,
  // a dialog gives it back when it closes. Escape still returns it to this button.
  const chosen = useRef(false);
  const choose = (to: LeadStage) => () => {
    chosen.current = true;
    onMove(to);
  };
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) chosen.current = false;
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label={label} data-move-menu />}
            />
          }
        >
          <MoveIcon />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" finalFocus={() => !chosen.current}>
        {moves.map((to) => (
          <DropdownMenuItem key={to} onClick={choose(to)}>
            <LeadStageBadge stage={to} />
          </DropdownMenuItem>
        ))}
        {moves.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={choose('won')}>
          <CircleCheckBigIcon />
          {t('leads.actions.convert')}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={choose('lost')}>
          <CircleXIcon />
          {t('leads.actions.lose')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {['a', 'b', 'c', 'd'].map((column) => (
        <Skeleton key={column} className="h-80 w-72 shrink-0" />
      ))}
    </div>
  );
}

// List

function ListView({
  search,
  filters,
  archived,
  filtered,
  newLead,
  rowGone,
}: {
  search: LeadsSearch;
  filters: LeadBoardFilters;
  archived: boolean;
  filtered: boolean;
  newLead: ReactNode;
  rowGone: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/leads/' });
  const page = search.page ?? 1;
  const sort = search.sort ?? 'nextFollowUpOn';
  const order = search.order ?? 'asc';
  const query: LeadListFilters = {
    ...filters,
    // Archived leads are listed whatever their stage.
    stage: archived ? [...LEAD_STAGES] : (search.stage ?? [...OPEN_LEAD_STAGES]),
    archived: archived ? 'true' : undefined,
    sort: search.sort,
    order: search.order,
    page,
    pageSize: PAGE_SIZE,
  };
  const leads = useQuery(leadListQuery(query));
  usePageInRange(
    page,
    leads.data?.total,
    PAGE_SIZE,
    useCallback(
      (next: number | undefined) =>
        navigate({ search: (previous) => ({ ...previous, page: next }), replace: true }),
      [navigate],
    ),
  );
  const sortBy = (column: LeadSort) => {
    // Dates of the past read newest first; the follow-up date soonest first.
    const first: SortDirection = column === 'nextFollowUpOn' ? 'asc' : 'desc';
    const next = column !== sort ? first : order === 'asc' ? 'desc' : 'asc';
    return navigate({
      search: (previous) => ({
        ...previous,
        sort: column === 'nextFollowUpOn' ? undefined : column,
        order: next === 'desc' ? 'desc' : undefined,
        page: undefined,
      }),
      replace: true,
    });
  };

  if (leads.isPending) return <TableSkeleton />;
  if (leads.isError) {
    return <LoadError message={t('leads.loadError')} onRetry={() => leads.refetch()} />;
  }
  if (leads.data.items.length === 0) {
    return archived && !filtered ? (
      <EmptyState icon={<ArchiveIcon />} title={t('leads.archivedEmptyTitle')} />
    ) : (
      <EmptyLeads filtered={filtered} newLead={newLead} />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <LeadsTable
        leads={leads.data.items}
        sort={sort}
        order={order}
        onSort={sortBy}
        rowGone={rowGone}
      />
      <Pagination
        page={page}
        pageCount={Math.ceil(leads.data.total / PAGE_SIZE)}
        onPageChange={(next) => navigate({ search: (previous) => ({ ...previous, page: next }) })}
        summary={t('common.pageSummary', {
          from: formatNumber((page - 1) * PAGE_SIZE + 1),
          to: formatNumber((page - 1) * PAGE_SIZE + leads.data.items.length),
          total: formatNumber(leads.data.total),
        })}
        previousLabel={t('common.previous')}
        nextLabel={t('common.next')}
      />
    </div>
  );
}

function LeadsTable({
  leads,
  sort,
  order,
  onSort,
  rowGone,
}: {
  leads: Lead[];
  sort: LeadSort;
  order: SortDirection;
  onSort: (column: LeadSort) => void;
  rowGone: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const scopeAll = canAll(me, 'leads.manage');
  const direction = (column: LeadSort) => (sort === column ? order : null);
  const [confirming, setConfirming] = useState<{ lead: Lead; restore: boolean } | null>(null);
  const archive = useArchiveLead();
  const restore = useRestoreLead();
  const returnFocus = useReturnFocus(rowGone);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('leads.columns.lead')}</TableHead>
            <TableSortHead
              direction={direction('stageChangedAt')}
              onSort={() => onSort('stageChangedAt')}
            >
              {t('leads.columns.stage')}
            </TableSortHead>
            <TableHead>{t('leads.columns.owner')}</TableHead>
            <TableSortHead
              direction={direction('nextFollowUpOn')}
              onSort={() => onSort('nextFollowUpOn')}
            >
              {t('leads.columns.followUp')}
            </TableSortHead>
            <TableHead>{t('leads.columns.interests')}</TableHead>
            <TableHead className="text-end">{t('leads.columns.budget')}</TableHead>
            <TableSortHead direction={direction('createdAt')} onSort={() => onSort('createdAt')}>
              {t('leads.columns.created')}
            </TableSortHead>
            {scopeAll && (
              <TableHead>
                <span className="sr-only">{t('leads.columns.actions')}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((lead) => (
            <TableRow key={lead.id}>
              <TableCell className="min-w-48 whitespace-normal">
                <Link
                  to="/leads/$leadId"
                  params={{ leadId: lead.id }}
                  className="group flex items-center gap-3 rounded-md outline-offset-4"
                >
                  <SourceMark source={lead.source} />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium group-hover:underline">{lead.displayName}</span>
                    {lead.companyName && (
                      <span className="text-xs text-muted-foreground">{lead.contactName}</span>
                    )}
                  </span>
                </Link>
              </TableCell>
              <TableCell>
                <span className="flex flex-col items-start gap-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <LeadStageBadge stage={lead.stage} />
                    {lead.archivedAt && <Badge tone="neutral">{t('leads.archivedBadge')}</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('leads.card.daysInStage', {
                      count: lead.daysInStage,
                      n: formatNumber(lead.daysInStage),
                    })}
                  </span>
                </span>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <Avatar
                    name={lead.owner.name}
                    size="sm"
                    tone={lead.owner.archived ? 'muted' : 'brand'}
                  />
                  {lead.owner.name}
                </span>
              </TableCell>
              <TableCell>
                {lead.client ? (
                  <span className="text-muted-foreground">{lead.client.name}</span>
                ) : (
                  <FollowUpDate lead={lead} />
                )}
              </TableCell>
              <TableCell className="max-w-56 whitespace-normal text-sm">
                {lead.interests.length > 0 ? (
                  lead.interests.join('، ')
                ) : (
                  <span className="text-muted-foreground">{t('common.none')}</span>
                )}
              </TableCell>
              <TableCell className="text-end">
                {lead.budgetMinor !== null ? (
                  <Budget lead={lead} />
                ) : (
                  <span className="text-muted-foreground">{t('common.none')}</span>
                )}
              </TableCell>
              <TableCell className="tabular-nums">{formatDate(lead.createdAt)}</TableCell>
              {scopeAll && (
                <TableCell>
                  {lead.stage !== 'won' && (
                    <RowMenu
                      lead={lead}
                      onChoose={(restore, opener) => {
                        returnFocus.from(opener);
                        setConfirming({ lead, restore });
                      }}
                    />
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ArchiveConfirm
        target={confirming}
        onClose={() => setConfirming(null)}
        pending={archive.isPending || restore.isPending}
        onConfirm={async (target) => {
          if (target.restore) await restore.mutateAsync(target.lead.id);
          else await archive.mutateAsync(target.lead.id);
        }}
        finalFocus={returnFocus.target}
      />
    </>
  );
}

/**
 * A row's archive or restore menu. The chosen action's dialog gives the focus back, so the menu
 * does not return it to its button, which leaves with the row once the action is done.
 */
function RowMenu({
  lead,
  onChoose,
}: {
  lead: Lead;
  onChoose: (restore: boolean, opener: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const button = useRef<HTMLButtonElement>(null);
  const chosen = useRef(false);
  const choose = (restore: boolean) => () => {
    chosen.current = true;
    onChoose(restore, button.current);
  };
  const label = t('leads.actions.menu', { name: lead.displayName });
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) chosen.current = false;
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button ref={button} variant="ghost" size="icon-sm" aria-label={label} />}
            />
          }
        >
          <EllipsisIcon />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" finalFocus={() => !chosen.current}>
        {lead.archivedAt ? (
          <DropdownMenuItem onClick={choose(true)}>
            <ArchiveRestoreIcon />
            {t('leads.actions.restore')}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem variant="destructive" onClick={choose(false)}>
            <ArchiveIcon />
            {t('leads.actions.archive')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Archive (junk, duplicates) or restore a lead (rule 12). */
export function ArchiveConfirm({
  target,
  onClose,
  pending,
  onConfirm,
  finalFocus,
}: {
  target: { lead: LeadRef; restore: boolean } | null;
  onClose: () => void;
  pending: boolean;
  onConfirm: (target: { lead: LeadRef; restore: boolean }) => Promise<void>;
  finalFocus: ComponentProps<typeof ConfirmDialog>['finalFocus'];
}) {
  const { t } = useTranslation();
  // The text stays while the dialog fades out.
  const shown = useShownWhileClosing(target);
  const restore = shown?.restore ?? false;
  const name = shown?.lead.displayName ?? '';
  return (
    <ConfirmDialog
      open={target !== null}
      onClose={onClose}
      finalFocus={finalFocus}
      title={
        restore ? t('leads.archive.restoreTitle', { name }) : t('leads.archive.title', { name })
      }
      body={restore ? t('leads.archive.restoreBody') : t('leads.archive.body')}
      action={restore ? t('leads.actions.restore') : t('leads.actions.archive')}
      destructive={!restore}
      pending={pending}
      onConfirm={async () => {
        if (!target) return;
        await onConfirm(target);
        toast.add({
          title: restore ? t('leads.archive.restored') : t('leads.archive.archived'),
          type: 'success',
        });
      }}
    />
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {['a', 'b', 'c', 'd', 'e'].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="size-5 rounded-sm" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="ms-auto h-4 w-32" />
        </div>
      ))}
    </div>
  );
}
