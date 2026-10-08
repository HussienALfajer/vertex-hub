import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  CLIENT_STATUSES,
  type ClientDetailResponse,
  type ClientStatus,
  type CreateClient,
  type CreateClientInput,
  createClientSchema,
  type UpdateClient,
} from '@vertex-hub/contracts';
import {
  AscentLines,
  Avatar,
  Badge,
  Button,
  Callout,
  ColorStrip,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  IconButton,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  EllipsisIcon,
  FileChartColumnIcon,
  FileTextIcon,
  FolderKanbanIcon,
  FolderOpenIcon,
  ListTodoIcon,
  MegaphoneIcon,
  MessagesSquareIcon,
  PaletteIcon,
  PencilIcon,
  ReceiptTextIcon,
  RepeatIcon,
  ShareIcon,
  ShieldAlertIcon,
  StampIcon,
  TagIcon,
  UserPlusIcon,
  UsersRoundIcon,
} from 'lucide-react';
import { type ReactNode, type RefObject, useCallback, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { isMissing, LoadError } from '../../components/load-error';
import { canAll, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { ClientApprovalsTab } from '../approvals/client-approvals-tab';
import { ClientAdsTab, hasCampaignAccess } from '../campaigns/client-ads-tab';
import { ClientContentTab } from '../content/client-content-tab';
import { ClientFilesTab } from '../files/client-files-tab';
import { type FileLibrarySearch, parseFileLibrarySearch } from '../files/library-search';
import { ClientInvoicesTab } from '../invoices/client-invoices-tab';
import { ConvertedFromLead } from '../leads/converted-from-lead';
import { ClientProjectsTab } from '../projects/client-projects-tab';
import { hasMoneyAccess, hasReportAccess } from '../projects/project-access';
import { ClientQuotesTab, hasQuoteAccess } from '../quotes/client-quotes-tab';
import { ClientRetainersTab, EndedClientWorkCallout } from '../retainers/client-retainers-tab';
import { ClientTasksTab } from '../tasks/client-tasks-tab';
import { BrandKitTab } from './brand-kit-tab';
import { ClientStatusBadge, HealthcareBadge } from './client-badges';
import {
  AccountManagerField,
  clientFormFailure,
  HealthcareField,
  SectorField,
  TradeNameField,
} from './client-form';
import {
  clientQuery,
  useArchiveClient,
  useRestoreClient,
  useUpdateClient,
} from './clients.queries';
import { CommunicationTab } from './communication-tab';
import { ContactsTab } from './contacts-tab';
import { PlatformsTab } from './platforms-tab';

const CLIENT_TABS = [
  'contacts',
  'projects',
  'retainers',
  'quotes',
  'invoices',
  'ads',
  'tasks',
  'content',
  'files',
  'approvals',
  'brand-kit',
  'platforms',
  'communication',
] as const;

type ClientTab = (typeof CLIENT_TABS)[number];

export interface ClientProfileSearch extends FileLibrarySearch {
  /** Unset means the first tab. */
  tab?: ClientTab;
}

export function parseClientProfileSearch(search: Record<string, unknown>): ClientProfileSearch {
  return {
    tab: CLIENT_TABS.find((tab) => tab !== 'contacts' && tab === search.tab),
    ...parseFileLibrarySearch(search),
  };
}

export function ClientProfilePage({
  clientId,
  search,
}: {
  clientId: string;
  search: ClientProfileSearch;
}) {
  const { t } = useTranslation();
  const client = useQuery(clientQuery(clientId));

  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/clients" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('clients.profile.back')}
        </Button>
      </div>
      {client.isPending ? (
        <ProfileSkeleton />
      ) : client.isError ? (
        <LoadError
          message={
            isMissing(client.error) ? t('clients.profile.notFound') : t('clients.profile.loadError')
          }
          onRetry={() => client.refetch()}
          error={client.error}
        />
      ) : (
        <Profile client={client.data} tab={search.tab ?? 'contacts'} search={search} />
      )}
    </>
  );
}

function Profile({
  client,
  tab,
  search,
}: {
  client: ClientDetailResponse;
  tab: ClientTab;
  search: ClientProfileSearch;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate({ from: '/clients/$clientId/' });
  const scopeAll = canAll(me, 'clients.manage');
  // Quotes are confidential to quote readers covering the client (F04 screen 7).
  const quoteReader = hasQuoteAccess(me, client.accountManager.id);
  // Invoices, balances and statements need `invoices.read` covering the client (F13 screen 5).
  const invoiceReader = hasMoneyAccess(me, client.accountManager.id);
  // The ad wallet and campaigns need `campaigns.read` covering the client (F12 screen 4).
  const adsReader = hasCampaignAccess(me, client.accountManager.id);
  // A link to a tab the user cannot see (an `ad_budget_low` for a campaign owner without
  // `campaigns.read`) opens the first tab instead of an empty one.
  const hidden =
    (tab === 'quotes' && !quoteReader) ||
    (tab === 'invoices' && !invoiceReader) ||
    (tab === 'ads' && !adsReader);
  const shownTab: ClientTab = hidden ? 'contacts' : tab;
  const archived = client.archivedAt !== null;
  // Archived clients are read-only (rule 7); the API refuses every change but restore.
  const editable = client.canManage && !archived;
  // The notice's button, while the contact dialog it opened is open.
  const [addingContact, setAddingContact] = useState<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState<'archive' | 'restore' | null>(null);
  // The action stays named while its dialog fades out.
  const shownConfirm = useShownWhileClosing(confirming);
  const archive = useArchiveClient(client.id);
  const restore = useRestoreClient(client.id);
  const heading = useRef<HTMLHeadingElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);

  const openTab = (next: ClientTab) =>
    navigate({
      search: (previous) => ({ ...previous, tab: next === 'contacts' ? undefined : next }),
      replace: true,
    });
  const setFileSearch = useCallback(
    (next: FileLibrarySearch) =>
      navigate({ search: (previous) => ({ ...previous, ...next }), replace: true }),
    [navigate],
  );

  return (
    <>
      <ClientHero
        client={client}
        editable={editable}
        scopeAll={scopeAll}
        heading={heading}
        menuButton={menuButton}
        onArchive={() => setConfirming('archive')}
      />

      {archived ? (
        <Callout
          icon={<ArchiveIcon />}
          title={t('clients.profile.archivedTitle')}
          description={t('clients.profile.archivedBody')}
          action={
            scopeAll && (
              <Button
                ref={restoreButton}
                variant="outline"
                size="sm"
                onClick={() => setConfirming('restore')}
              >
                <ArchiveRestoreIcon />
                {t('clients.profile.restore')}
              </Button>
            )
          }
        />
      ) : (
        !client.hasApprovalContact && (
          <Callout
            tone="warning"
            icon={<ShieldAlertIcon />}
            title={t('clients.profile.noApprovalTitle')}
            description={t('clients.profile.noApprovalBody')}
            action={
              editable && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(event) => {
                    void openTab('contacts');
                    setAddingContact(event.currentTarget);
                  }}
                >
                  <UserPlusIcon />
                  {t('clients.contacts.add')}
                </Button>
              )
            }
          />
        )
      )}

      <EndedClientWorkCallout client={client} />

      <Tabs value={shownTab} onValueChange={(value: ClientTab) => openTab(value)}>
        <TabsList aria-label={t('clients.title')}>
          <TabsTrigger value="contacts">
            <UsersRoundIcon />
            {t('clients.profile.tabs.contacts')}
            <Counter value={client.contacts.length} />
          </TabsTrigger>
          <TabsTrigger value="projects">
            <FolderKanbanIcon />
            {t('clients.profile.tabs.projects')}
          </TabsTrigger>
          <TabsTrigger value="retainers">
            <RepeatIcon />
            {t('clients.profile.tabs.retainers')}
          </TabsTrigger>
          {quoteReader && (
            <TabsTrigger value="quotes">
              <FileTextIcon />
              {t('clients.profile.tabs.quotes')}
            </TabsTrigger>
          )}
          {invoiceReader && (
            <TabsTrigger value="invoices">
              <ReceiptTextIcon />
              {t('clients.profile.tabs.invoices')}
            </TabsTrigger>
          )}
          {adsReader && (
            <TabsTrigger value="ads">
              <MegaphoneIcon />
              {t('clients.profile.tabs.ads')}
            </TabsTrigger>
          )}
          <TabsTrigger value="tasks">
            <ListTodoIcon />
            {t('clients.profile.tabs.tasks')}
          </TabsTrigger>
          <TabsTrigger value="content">
            <CalendarDaysIcon />
            {t('clients.profile.tabs.content')}
          </TabsTrigger>
          <TabsTrigger value="files">
            <FolderOpenIcon />
            {t('clients.profile.tabs.files')}
          </TabsTrigger>
          <TabsTrigger value="approvals">
            <StampIcon />
            {t('clients.profile.tabs.approvals')}
          </TabsTrigger>
          <TabsTrigger value="brand-kit">
            <PaletteIcon />
            {t('clients.profile.tabs.brandKit')}
          </TabsTrigger>
          <TabsTrigger value="platforms">
            <ShareIcon />
            {t('clients.profile.tabs.platforms')}
            <Counter value={client.platformAccounts.length} />
          </TabsTrigger>
          <TabsTrigger value="communication">
            <MessagesSquareIcon />
            {t('clients.profile.tabs.communication')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="contacts">
          <ContactsTab
            client={client}
            editable={editable}
            adding={addingContact}
            onAddingChange={setAddingContact}
          />
        </TabsContent>
        <TabsContent value="projects">
          <ClientProjectsTab client={client} />
        </TabsContent>
        <TabsContent value="retainers">
          <ClientRetainersTab client={client} />
        </TabsContent>
        {quoteReader && (
          <TabsContent value="quotes">
            <ClientQuotesTab client={client} />
          </TabsContent>
        )}
        {invoiceReader && (
          <TabsContent value="invoices">
            <ClientInvoicesTab client={client} />
          </TabsContent>
        )}
        {adsReader && (
          <TabsContent value="ads">
            <ClientAdsTab client={client} />
          </TabsContent>
        )}
        <TabsContent value="tasks">
          <ClientTasksTab client={client} />
        </TabsContent>
        <TabsContent value="content">
          <ClientContentTab client={client} />
        </TabsContent>
        <TabsContent value="files">
          <ClientFilesTab client={client} search={search} onSearchChange={setFileSearch} />
        </TabsContent>
        <TabsContent value="approvals">
          <ClientApprovalsTab client={client} />
        </TabsContent>
        <TabsContent value="brand-kit">
          <BrandKitTab client={client} editable={editable} />
        </TabsContent>
        <TabsContent value="platforms">
          <PlatformsTab client={client} editable={editable} />
        </TabsContent>
        <TabsContent value="communication">
          <CommunicationTab client={client} archived={archived} />
        </TabsContent>
      </Tabs>

      {/* Outside the menu and the notice: both leave the page with the action. */}
      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={t(`clients.profile.confirm.${shownConfirm ?? 'archive'}Title`, {
          name: client.tradeName,
        })}
        body={t(`clients.profile.confirm.${shownConfirm ?? 'archive'}Body`)}
        action={t(`clients.profile.confirm.${shownConfirm ?? 'archive'}Action`)}
        destructive={shownConfirm === 'archive'}
        pending={archive.isPending || restore.isPending}
        // The focus goes to the button that undoes the change, or back to the one that opened it.
        finalFocus={() => restoreButton.current ?? menuButton.current ?? heading.current ?? true}
        onConfirm={async () => {
          if (confirming === 'restore') {
            await restore.mutateAsync(undefined);
            toast.add({ title: t('clients.profile.confirm.restored'), type: 'success' });
          } else {
            await archive.mutateAsync(undefined);
            toast.add({ title: t('clients.profile.confirm.archived'), type: 'success' });
          }
        }}
      />
    </>
  );
}

function Counter({ value }: { value: number }) {
  if (value === 0) return null;
  return (
    <Badge tone="neutral" className="h-5 min-w-5 justify-center px-1.5 tabular-nums">
      {formatNumber(value)}
    </Badge>
  );
}

/**
 * The client at a glance. Its brand palette runs along the bottom edge once the brand kit has
 * colors, so each profile carries the client's own identity; the 60° hairlines mark the corner.
 */
function ClientHero({
  client,
  editable,
  scopeAll,
  heading,
  menuButton,
  onArchive,
}: {
  client: ClientDetailResponse;
  editable: boolean;
  scopeAll: boolean;
  heading: RefObject<HTMLHeadingElement | null>;
  menuButton: RefObject<HTMLButtonElement | null>;
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  const archived = client.archivedAt !== null;
  const colors = client.brandKit.colors.map((color) => color.hex);
  const me = useMe();
  // The monthly report needs `reports.read` covering the client (F15 screen 6).
  const reportReader = !archived && hasReportAccess(me, client.accountManager.id);

  return (
    <section className="relative overflow-hidden rounded-lg border border-border bg-surface">
      <AscentLines className="absolute inset-y-0 end-0 hidden h-full w-32 text-border md:block" />
      <div className="relative flex flex-col gap-6 p-6 xl:flex-row xl:items-center">
        <Avatar
          name={client.tradeName}
          shape="square"
          size="xl"
          tone={archived || client.status === 'ended' ? 'muted' : 'brand'}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 ref={heading} tabIndex={-1} className="min-w-0 text-2xl font-bold wrap-anywhere">
              {client.tradeName}
            </h1>
            <ClientStatusBadge status={client.status} />
            {client.isHealthcare && <HealthcareBadge />}
            {archived && <Badge tone="neutral">{t('clients.archivedBadge')}</Badge>}
          </div>
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <HeroFact label={t('clients.profile.accountManager')}>
              <Link
                to="/team/$userId"
                params={{ userId: client.accountManager.id }}
                className="flex items-center gap-2 font-medium hover:underline"
              >
                <Avatar
                  name={client.accountManager.name}
                  size="sm"
                  tone={client.accountManager.archived ? 'muted' : 'brand'}
                />
                {client.accountManager.name}
              </Link>
              {client.accountManager.archived && (
                <Badge tone="outline">{t('clients.archivedBadge')}</Badge>
              )}
            </HeroFact>
            <HeroFact label={t('clients.form.sector')}>
              <span className="flex items-center gap-1.5">
                <TagIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                {client.sector ?? (
                  <span className="text-muted-foreground">{t('clients.profile.noSector')}</span>
                )}
              </span>
            </HeroFact>
          </dl>
          <ConvertedFromLead clientId={client.id} />
        </div>
        {(editable || (scopeAll && !archived) || reportReader) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {reportReader && (
              <Button
                variant="outline"
                render={<Link to="/clients/$clientId/report" params={{ clientId: client.id }} />}
              >
                <FileChartColumnIcon />
                {t('clients.profile.monthlyReport')}
              </Button>
            )}
            {editable && <EditBasics client={client} scopeAll={scopeAll} />}
            {editable && <StatusMenu client={client} />}
            {scopeAll && !archived && <ClientMenu menuButton={menuButton} onArchive={onArchive} />}
          </div>
        )}
      </div>
      {colors.length > 0 && <ColorStrip colors={colors} className="relative h-2" />}
    </section>
  );
}

function HeroFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="sr-only">{label}</dt>
      <dd className="flex items-center gap-2">{children}</dd>
    </div>
  );
}

function StatusMenu({ client }: { client: ClientDetailResponse }) {
  const { t } = useTranslation();
  const update = useUpdateClient(client.id);

  async function change(status: ClientStatus) {
    try {
      await update.mutateAsync({ status });
      toast.add({ title: t('clients.profile.statusChanged'), type: 'success' });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" disabled={update.isPending} />}>
        {t('clients.profile.status', { status: t(`clients.statuses.${client.status}`) })}
        <ChevronDownIcon className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('clients.profile.changeStatus')}</DropdownMenuLabel>
          {CLIENT_STATUSES.map((status) => (
            <DropdownMenuItem
              key={status}
              disabled={status === client.status}
              onClick={() => change(status)}
            >
              <ClientStatusBadge status={status} />
              {status === client.status && <CheckIcon className="ms-auto" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ClientMenu({
  menuButton,
  onArchive,
}: {
  menuButton: RefObject<HTMLButtonElement | null>;
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton
            ref={menuButton}
            variant="outline"
            size="icon"
            label={t('clients.profile.actions')}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem variant="destructive" onClick={onArchive}>
          <ArchiveIcon />
          {t('clients.profile.archive')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Trade name and sector; the account manager and healthcare flag for scope-all holders (rule 5). */
function EditBasics({ client, scopeAll }: { client: ClientDetailResponse; scopeAll: boolean }) {
  const { t } = useTranslation();
  const update = useUpdateClient(client.id);
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<CreateClientInput, unknown, CreateClient>({
    resolver: standardSchemaResolver(createClientSchema),
    // A refetch keeps what the user already changed.
    resetOptions: { keepDirtyValues: true },
    values: {
      tradeName: client.tradeName,
      sector: client.sector ?? '',
      accountManagerId: client.accountManager.id,
      status: client.status,
      isHealthcare: client.isHealthcare,
    },
  });

  // After the exit animation: the next opening starts from the saved client. A plain `reset()`
  // would apply `keepDirtyValues` and keep what was typed (or typed before the API trimmed it).
  function closed() {
    setFailure(null);
    form.reset(undefined, { keepDirtyValues: false });
  }

  // Only what changed is sent, so an unchanged scope-all field never reaches the API.
  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const dirty = form.formState.dirtyFields;
    const changes: UpdateClient = {
      ...(dirty.tradeName && { tradeName: values.tradeName }),
      ...(dirty.sector && { sector: values.sector ?? null }),
      ...(dirty.accountManagerId && { accountManagerId: values.accountManagerId }),
      ...(dirty.isHealthcare && { isHealthcare: values.isHealthcare }),
    };
    // Nothing changed: close without a request or a "saved" toast.
    if (Object.keys(changes).length === 0) return setOpen(false);
    try {
      await update.mutateAsync(changes);
      toast.add({ title: t('clients.profile.saved'), type: 'success' });
      setOpen(false);
    } catch (error) {
      setFailure(clientFormFailure(form, t, error));
    }
  });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PencilIcon />
        {t('clients.profile.edit')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} onOpenChangeComplete={(next) => !next && closed()}>
        <DialogContent closeLabel={t('common.close')} className="max-w-xl">
          <form className="grid gap-5" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>{t('clients.profile.editTitle')}</DialogTitle>
              {!scopeAll && <DialogDescription>{t('clients.profile.editHint')}</DialogDescription>}
            </DialogHeader>
            <TradeNameField form={form} />
            <SectorField form={form} />
            {scopeAll && (
              <>
                <AccountManagerField form={form} current={client.accountManager} />
                <HealthcareField form={form} />
              </>
            )}
            {failure && <FormAlert>{failure}</FormAlert>}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                {t('common.cancel')}
              </DialogClose>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? t('common.saving') : t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-6 rounded-lg border border-border bg-surface p-6">
        <Skeleton className="size-20 rounded-lg" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <Skeleton className="h-11" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
