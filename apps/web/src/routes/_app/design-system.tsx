import { createFileRoute } from '@tanstack/react-router';
import { WORKFLOW_STATUSES, type WorkflowStatus } from '@vertex-hub/contracts';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
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
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@vertex-hub/ui';
import { ArchiveIcon, CopyIcon, EllipsisIcon, PencilIcon } from 'lucide-react';
import type { ReactNode } from 'react';
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
              <TableHead>{t('designSystem.due')}</TableHead>
              <TableHead className="text-end">{t('designSystem.amount')}</TableHead>
              <TableHead>{t('designSystem.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sampleRows.map((row) => (
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
        </div>
      </Section>
    </>
  );
}
