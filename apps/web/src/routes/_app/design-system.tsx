import { createFileRoute } from '@tanstack/react-router';
import {
  CLIENT_PLATFORMS,
  CLIENT_STATUSES,
  type ClientStatus,
  WORKFLOW_STATUSES,
  type WorkflowStatus,
} from '@vertex-hub/contracts';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AscentMeter,
  Autocomplete,
  Avatar,
  Button,
  Callout,
  Card,
  CardHeader,
  CardTitle,
  Checkbox,
  ColorInput,
  ColorStrip,
  ColorSwatch,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Meter,
  MultiCombobox,
  OtpField,
  PageHeader,
  Pagination,
  PlatformMark,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  Switch,
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
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  CopyIcon,
  EllipsisIcon,
  ListTodoIcon,
  MessagesSquareIcon,
  PencilIcon,
  PlusIcon,
  ShieldAlertIcon,
  UserPlusIcon,
  UsersRoundIcon,
} from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';

export const Route = createFileRoute('/_app/design-system')({
  component: DesignSystemPage,
});

const swatches = [
  'bg-green-800',
  'bg-green-600',
  'bg-green-200',
  'bg-gold-400',
  'bg-gold-700',
  'bg-neutral-50',
  'bg-neutral-200',
  'bg-neutral-600',
  'bg-neutral-900',
] as const;

const departments = ['design', 'content', 'video'] as const;

const sampleRows: {
  task: 'logo' | 'reel' | 'calendar';
  client: 'jasmine' | 'clinic' | 'store';
  due: string;
  amountMinor: number;
  status: WorkflowStatus;
}[] = [
  {
    task: 'logo',
    client: 'jasmine',
    due: '2026-10-04',
    amountMinor: 120_000,
    status: 'in_progress',
  },
  {
    task: 'reel',
    client: 'clinic',
    due: '2026-10-07',
    amountMinor: 45_000,
    status: 'awaiting_client',
  },
  { task: 'calendar', client: 'store', due: '2026-10-01', amountMinor: 80_000, status: 'approved' },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      {children}
    </Card>
  );
}

function DesignSystemPage() {
  const { t } = useTranslation();
  const departmentItems = departments.map((value) => ({
    value,
    label: t(`designSystem.departments.${value}`),
  }));
  const [dueOrder, setDueOrder] = useState<'asc' | 'desc'>('asc');
  const rows = [...sampleRows].sort((a, b) =>
    dueOrder === 'asc' ? a.due.localeCompare(b.due) : b.due.localeCompare(a.due),
  );

  return (
    <>
      <PageHeader title={t('designSystem.title')} description={t('designSystem.subtitle')} />

      <Section title={t('designSystem.colors')}>
        <div className="flex flex-wrap gap-2">
          {swatches.map((swatch) => (
            <div key={swatch} className="flex flex-col items-center gap-1">
              <span className={`size-12 rounded-md border border-border ${swatch}`} />
              <span dir="ltr" className="text-xs text-muted-foreground">
                {swatch.replace('bg-', '')}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t('designSystem.buttons')}>
        <div className="flex flex-wrap items-center gap-3">
          <Button>{t('designSystem.primary')}</Button>
          <Button variant="secondary">{t('designSystem.secondary')}</Button>
          <Button variant="outline">{t('designSystem.outline')}</Button>
          <Button variant="ghost">{t('designSystem.ghost')}</Button>
          <Button variant="destructive">{t('designSystem.destructive')}</Button>
          <Button size="sm">{t('designSystem.primary')}</Button>
          <Button disabled>{t('designSystem.primary')}</Button>
        </div>
      </Section>

      <Section title={t('designSystem.fields')}>
        <div className="grid gap-6 md:grid-cols-2">
          <Field>
            <FieldLabel>{t('designSystem.clientName')}</FieldLabel>
            <Input placeholder={t('designSystem.clientNamePlaceholder')} />
            <FieldDescription>{t('designSystem.clientNameHint')}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>{t('designSystem.department')}</FieldLabel>
            <Select items={departmentItems}>
              <SelectTrigger>
                <SelectValue placeholder={t('designSystem.departmentPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {departmentItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      <Section title={t('designSystem.meters')}>
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { value: 2, max: 5 },
            { value: 4, max: 5 },
            { value: 5, max: 5 },
          ].map(({ value, max }) => (
            <div key={value} className="flex flex-col gap-2">
              <AscentMeter
                value={value}
                max={max}
                tone="success"
                aria-label={t('designSystem.meterSteps', { value, max })}
              />
              <span className="text-sm text-muted-foreground">
                {t('designSystem.meterSteps', { value, max })}
              </span>
            </div>
          ))}
          {(['brand', 'warning', 'danger'] as const).map((tone, index) => (
            <Meter
              key={tone}
              value={40 + index * 25}
              tone={tone}
              aria-label={t('designSystem.meterTime')}
            />
          ))}
          {[35, null].map((value) => (
            <Progress
              key={String(value)}
              value={value}
              aria-label={t('designSystem.progressUpload')}
            />
          ))}
        </div>
      </Section>

      <Section title={t('designSystem.statuses')}>
        <div className="flex flex-wrap gap-2">
          {WORKFLOW_STATUSES.map((status) => (
            <StatusBadge key={status} status={status}>
              {t(`workflow.${status}`)}
            </StatusBadge>
          ))}
        </div>
      </Section>

      <Section title={t('designSystem.table')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('designSystem.task')}</TableHead>
              <TableHead>{t('designSystem.client')}</TableHead>
              <TableSortHead
                direction={dueOrder}
                onSort={() => setDueOrder(dueOrder === 'asc' ? 'desc' : 'asc')}
              >
                {t('designSystem.due')}
              </TableSortHead>
              <TableHead className="text-end">{t('designSystem.amount')}</TableHead>
              <TableHead>{t('designSystem.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.task}>
                <TableCell className="font-medium">
                  {t(`designSystem.sampleTasks.${row.task}`)}
                </TableCell>
                <TableCell>{t(`designSystem.sampleClients.${row.client}`)}</TableCell>
                <TableCell dir="ltr" className="text-end">
                  {row.due}
                </TableCell>
                <TableCell className="text-end">
                  {formatNumber(row.amountMinor / 100, {
                    style: 'currency',
                    currency: 'USD',
                    currencyDisplay: 'code',
                  })}
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.status}>{t(`workflow.${row.status}`)}</StatusBadge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <PeopleSection />

      <ClientKitSection />

      <Section title={t('designSystem.overlays')}>
        <div className="flex flex-wrap items-center gap-3">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>
              {t('designSystem.openDialog')}
            </DialogTrigger>
            <DialogContent closeLabel={t('common.close')}>
              <DialogHeader>
                <DialogTitle>{t('designSystem.dialogTitle')}</DialogTitle>
                <DialogDescription>{t('designSystem.dialogBody')}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  {t('common.cancel')}
                </DialogClose>
                <DialogClose render={<Button variant="destructive" />}>
                  {t('designSystem.destructive')}
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" />}>
              {t('designSystem.openAlert')}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('designSystem.dialogTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('designSystem.dialogBody')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose render={<Button variant="outline" />}>
                  {t('common.cancel')}
                </AlertDialogClose>
                <AlertDialogClose render={<Button variant="destructive" />}>
                  {t('designSystem.destructive')}
                </AlertDialogClose>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>
              {t('designSystem.openMenu')}
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>
                <PencilIcon />
                {t('designSystem.menuEdit')}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <CopyIcon />
                {t('designSystem.menuDuplicate')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">
                <ArchiveIcon />
                {t('designSystem.menuArchive')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="secondary"
            onClick={() =>
              toast.add({
                title: t('designSystem.toastTitle'),
                description: t('designSystem.toastBody'),
                type: 'success',
              })
            }
          >
            {t('designSystem.showToast')}
          </Button>

          <Button
            variant="secondary"
            onClick={() => {
              const id = toast.add({
                title: t('designSystem.toastTitle'),
                description: t('designSystem.toastBody'),
                type: 'info',
                actionProps: {
                  children: t('designSystem.toastAction'),
                  onClick: () => toast.close(id),
                },
              });
            }}
          >
            {t('designSystem.showActionToast')}
          </Button>

          <Popover>
            <PopoverTrigger render={<Button variant="outline" />}>
              {t('designSystem.openPopover')}
            </PopoverTrigger>
            <PopoverContent className="gap-2 p-4">
              <PopoverTitle>{t('designSystem.popoverTitle')}</PopoverTitle>
              <p className="text-sm text-muted-foreground">{t('designSystem.popoverBody')}</p>
            </PopoverContent>
          </Popover>
        </div>
      </Section>
    </>
  );
}

const sampleSkills = ['figma', 'motion', 'copy', 'premiere', 'product'] as const;

/** Avatars, checkbox, multi-select with chips, one-time code, empty state, loading and paging. */
function PeopleSection() {
  const { t } = useTranslation();
  const ids = { skills: useId(), agree: useId(), otp: useId() };
  const skillItems = sampleSkills.map((key) => t(`designSystem.sampleSkills.${key}`));
  const [skills, setSkills] = useState<string[]>(() => skillItems.slice(0, 2));
  const [agree, setAgree] = useState(true);
  const [code, setCode] = useState('482');
  const [page, setPage] = useState(2);
  return (
    <Section title={t('designSystem.people')}>
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <Avatar name={t('designSystem.sampleName')} size="xl" />
            <Avatar name={t('designSystem.sampleName')} size="lg" />
            <Avatar name={t('designSystem.sampleName2')} size="md" tone="accent" />
            <Avatar name={t('designSystem.sampleName2')} size="sm" tone="muted" />
          </div>
          <Field>
            <FieldLabel htmlFor={ids.skills}>{t('designSystem.skillsLabel')}</FieldLabel>
            <MultiCombobox<string>
              id={ids.skills}
              items={skillItems}
              value={skills}
              onValueChange={setSkills}
              itemToLabel={(skill) => skill}
              itemToKey={(skill) => skill}
              emptyLabel={t('users.form.noMatches')}
              removeLabel={(label) => t('users.form.remove', { label })}
              create={{
                label: (skill) => t('users.form.addSkill', { skill }),
                toItem: (skill) => skill,
              }}
            />
          </Field>
          <label htmlFor={ids.agree} className="flex items-center gap-3 text-sm">
            <Checkbox id={ids.agree} checked={agree} onCheckedChange={setAgree} />
            {t('designSystem.agree')}
          </label>
          <div className="flex flex-col gap-2">
            <label htmlFor={ids.otp} className="text-sm font-medium">
              {t('designSystem.otp')}
            </label>
            <OtpField
              id={ids.otp}
              value={code}
              onValueChange={setCode}
              slotLabel={(position) => t('twoFactorSetup.digit', { position })}
              className="justify-start"
            />
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <EmptyState
            icon={<ListTodoIcon />}
            title={t('designSystem.emptyTitle')}
            description={t('designSystem.emptyBody')}
            action={
              <Button size="sm">
                <PlusIcon />
                {t('designSystem.emptyAction')}
              </Button>
            }
          />
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Pagination
            page={page}
            pageCount={3}
            onPageChange={setPage}
            summary={t('common.pageSummary', {
              from: formatNumber((page - 1) * 25 + 1),
              to: formatNumber(Math.min(page * 25, 57)),
              total: formatNumber(57),
            })}
            previousLabel={t('common.previous')}
            nextLabel={t('common.next')}
          />
        </div>
      </div>
    </Section>
  );
}

const sampleSectors = ['restaurants', 'clinics', 'stores'] as const;

/** Brand palette as data: token colors stand in for a client's own hex codes. */
const samplePalette = [
  'var(--color-green-800)',
  'var(--color-gold-400)',
  'var(--color-neutral-100)',
  'var(--color-info-600)',
];

/** Tabs, notices, form controls, content colors and platform marks (F02 client profile). */
function ClientKitSection() {
  const { t } = useTranslation();
  const ids = { healthcare: useId(), sector: useId(), notes: useId(), status: useId() };
  const [healthcare, setHealthcare] = useState(true);
  const [sector, setSector] = useState('');
  const [status, setStatus] = useState<ClientStatus>('active');
  const [color, setColor] = useState('');
  return (
    <Section title={t('designSystem.brand')}>
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Tabs defaultValue="overview">
            <TabsList aria-label={t('designSystem.tabs')}>
              <TabsTrigger value="overview">{t('designSystem.tabOverview')}</TabsTrigger>
              <TabsTrigger value="contacts">
                <UsersRoundIcon />
                {t('designSystem.tabContacts')}
              </TabsTrigger>
              <TabsTrigger value="activity">
                <MessagesSquareIcon />
                {t('designSystem.tabActivity')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <p className="text-muted-foreground">{t('designSystem.tabBody')}</p>
            </TabsContent>
            <TabsContent value="contacts">
              <p className="text-muted-foreground">{t('designSystem.tabBody')}</p>
            </TabsContent>
            <TabsContent value="activity">
              <p className="text-muted-foreground">{t('designSystem.tabBody')}</p>
            </TabsContent>
          </Tabs>
          <Callout
            tone="warning"
            icon={<ShieldAlertIcon />}
            title={t('designSystem.calloutTitle')}
            description={t('designSystem.calloutBody')}
            action={
              <Button variant="outline" size="sm">
                <UserPlusIcon />
                {t('designSystem.calloutAction')}
              </Button>
            }
          />
          <Callout icon={<ArchiveIcon />} title={t('designSystem.dialogTitle')} />
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={t('designSystem.clientJasmine')} shape="square" size="lg" />
              <Avatar name={t('designSystem.clientStore')} shape="square" tone="muted" />
              {CLIENT_PLATFORMS.map((platform) => (
                <PlatformMark
                  key={platform}
                  platform={platform}
                  size="sm"
                  label={t(`clients.platforms.names.${platform}`)}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <label htmlFor={ids.healthcare} className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{t('designSystem.switchLabel')}</span>
            <Switch id={ids.healthcare} checked={healthcare} onCheckedChange={setHealthcare} />
          </label>
          <Field>
            <FieldLabel id={ids.status} render={<span />}>
              {t('designSystem.segmented')}
            </FieldLabel>
            <ToggleGroup
              aria-labelledby={ids.status}
              value={[status]}
              onValueChange={(next: ClientStatus[]) => next[0] && setStatus(next[0])}
            >
              {CLIENT_STATUSES.map((value) => (
                <ToggleGroupItem key={value} value={value}>
                  {t(`clients.statuses.${value}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.sector}>{t('designSystem.sector')}</FieldLabel>
            <Autocomplete
              id={ids.sector}
              value={sector}
              onValueChange={setSector}
              suggestions={sampleSectors.map((key) => t(`designSystem.sampleSectors.${key}`))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.notes}>{t('designSystem.notes')}</FieldLabel>
            <Textarea id={ids.notes} placeholder={t('designSystem.notesPlaceholder')} />
          </Field>
          <div className="flex flex-col gap-3">
            <ColorStrip colors={samplePalette} className="rounded-sm" />
            <div className="flex items-center gap-2">
              {samplePalette.map((swatch) => (
                <ColorSwatch key={swatch} color={swatch} className="size-8" />
              ))}
              <ColorInput
                value={color}
                onChange={setColor}
                pickLabel={t('clients.brandKit.form.pickColor')}
                className="ms-auto w-44"
              />
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
