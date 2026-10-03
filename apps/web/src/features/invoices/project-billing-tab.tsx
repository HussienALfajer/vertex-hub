import { useQuery } from '@tanstack/react-query';
import type { ProjectBilling, ProjectDetail, ProjectExpense } from '@vertex-hub/contracts';
import {
  Button,
  Card,
  cn,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-hub/ui';
import { ArchiveIcon, PencilIcon, PlusIcon, ReceiptTextIcon, WalletIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { formatCalendarDate } from '../../lib/format';
import { PersonName } from '../projects/project-badges';
import { Money } from '../quotes/quote-badges';
import { ExpenseDialog } from './expense-dialog';
import { projectBillingQuery, useArchiveExpense } from './invoices.queries';
import { InvoicesTable } from './invoices-page';
import { CreateFromSource, SourceInvoiceCell } from './source-invoice';

/**
 * Spec screen 6: the project's money for money access — the margin in USD, each milestone's
 * installment and invoice, the project's invoices and its direct expenses.
 */
export function ProjectBillingTab({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const billing = useQuery(projectBillingQuery(project.id));
  if (billing.isPending) return <BillingSkeleton />;
  if (billing.isError) {
    return (
      <LoadError
        message={t('invoices.billing.loadError')}
        onRetry={() => billing.refetch()}
        error={billing.error}
      />
    );
  }
  return <ProjectBillingView billing={billing.data} clientId={project.client.id} />;
}

function ProjectBillingView({ billing, clientId }: { billing: ProjectBilling; clientId: string }) {
  const { t } = useTranslation();
  const me = useMe();
  // Archived projects give no new drafts (rule 1); the API refuses them too.
  const canInvoice = can(me, 'invoices.manage') && !billing.project.archived;
  const none = <span className="text-muted-foreground">{t('common.none')}</span>;

  return (
    <div className="flex flex-col gap-6">
      <MarginCards billing={billing} />

      <BillingSection title={t('invoices.billing.milestones')}>
        {billing.milestones.length === 0 ? (
          <EmptyState
            icon={<ReceiptTextIcon />}
            title={t('invoices.billing.noMilestones')}
            description={t('invoices.billing.noMilestonesHint')}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('invoices.billing.milestone')}</TableHead>
                <TableHead>{t('invoices.billing.milestoneStatus')}</TableHead>
                <TableHead>{t('invoices.billing.dueDate')}</TableHead>
                <TableHead className="text-end">{t('invoices.billing.installment')}</TableHead>
                <TableHead>{t('invoices.billing.invoice')}</TableHead>
                {canInvoice && (
                  <TableHead>
                    <span className="sr-only">{t('invoices.billing.actions')}</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {billing.milestones.map((milestone) => (
                <TableRow key={milestone.id}>
                  <TableCell className="whitespace-normal font-medium">{milestone.name}</TableCell>
                  <TableCell>{t(`projects.milestones.statuses.${milestone.status}`)}</TableCell>
                  <TableCell>
                    {milestone.dueDate ? formatCalendarDate(milestone.dueDate) : none}
                  </TableCell>
                  <TableCell className="text-end">
                    {milestone.installmentMinor !== null ? (
                      <Money
                        minor={milestone.installmentMinor}
                        currency={billing.project.currency}
                      />
                    ) : (
                      none
                    )}
                  </TableCell>
                  <TableCell>
                    <SourceInvoiceCell invoice={milestone.invoice} />
                  </TableCell>
                  {canInvoice && (
                    <TableCell className="text-end">
                      {!milestone.invoice && !!milestone.installmentMinor && (
                        <CreateFromSource
                          clientId={clientId}
                          currency={billing.project.currency}
                          source={{ type: 'milestone', id: milestone.id }}
                          name={milestone.name}
                        />
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </BillingSection>

      <BillingSection title={t('invoices.billing.invoices')}>
        {billing.invoices.length === 0 ? (
          <EmptyState
            icon={<ReceiptTextIcon />}
            title={t('invoices.billing.noInvoices')}
            description={t('invoices.billing.noInvoicesHint')}
          />
        ) : (
          <InvoicesTable invoices={billing.invoices} showClient={false} showEngagement={false} />
        )}
      </BillingSection>

      <ExpensesSection billing={billing} />
    </div>
  );
}

/** Rule 27: invoiced, collected, expenses and margin in USD, with the planned installments. */
function MarginCards({ billing }: { billing: ProjectBilling }) {
  const { t } = useTranslation();
  const { margin } = billing;
  return (
    <section aria-label={t('invoices.billing.margin')} className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label={t('invoices.billing.invoiced')}>
          <Money minor={margin.invoicedUsdMinor} currency="USD" />
        </Figure>
        <Figure label={t('invoices.billing.collected')}>
          <Money minor={margin.collectedUsdMinor} currency="USD" />
        </Figure>
        <Figure label={t('invoices.billing.expenses')}>
          <Money minor={margin.expensesUsdMinor} currency="USD" />
        </Figure>
        <Figure label={t('invoices.billing.margin')} strong>
          <Money
            minor={margin.marginUsdMinor}
            currency="USD"
            className={cn(margin.marginUsdMinor < 0 && 'text-destructive-text')}
          />
        </Figure>
      </div>
      <p className="text-sm text-muted-foreground">
        {t('invoices.billing.planned')}{' '}
        <Money minor={margin.plannedInstallmentsMinor} currency={billing.project.currency} />
      </p>
    </section>
  );
}

function Figure({
  label,
  strong,
  children,
}: {
  label: string;
  strong?: boolean;
  children: ReactNode;
}) {
  return (
    <Card className={cn('gap-1 p-4', strong && 'border-primary')}>
      <h3 className="text-sm text-muted-foreground">{label}</h3>
      <p className={cn('text-lg', strong ? 'font-bold' : 'font-medium')}>{children}</p>
    </Card>
  );
}

function ExpensesSection({ billing }: { billing: ProjectBilling }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProjectExpense | null>(null);
  const [archiving, setArchiving] = useState<ProjectExpense | null>(null);
  const archive = useArchiveExpense(billing.project.id);
  const manage = billing.canManageExpenses;

  return (
    <BillingSection
      title={t('invoices.expenses.heading')}
      action={
        manage && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <PlusIcon />
            {t('invoices.expenses.add')}
          </Button>
        )
      }
    >
      {billing.expenses.length === 0 ? (
        <EmptyState
          icon={<WalletIcon />}
          title={t('invoices.expenses.empty')}
          description={t('invoices.expenses.emptyHint')}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('invoices.expenses.spentOn')}</TableHead>
              <TableHead>{t('invoices.expenses.description')}</TableHead>
              <TableHead className="text-end">{t('invoices.expenses.amount')}</TableHead>
              <TableHead className="text-end">{t('invoices.expenses.usd')}</TableHead>
              <TableHead>{t('invoices.expenses.loggedBy')}</TableHead>
              {manage && (
                <TableHead>
                  <span className="sr-only">{t('invoices.billing.actions')}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {billing.expenses.map((expense) => (
              <TableRow key={expense.id}>
                <TableCell>{formatCalendarDate(expense.spentOn)}</TableCell>
                <TableCell className="whitespace-normal">
                  <span className="flex flex-col">
                    <span>{expense.description}</span>
                    {expense.note && (
                      <span className="text-xs text-muted-foreground">{expense.note}</span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-end">
                  <Money minor={expense.amountMinor} currency={expense.currency} />
                </TableCell>
                <TableCell className="text-end">
                  <Money minor={expense.usdMinor} currency="USD" />
                </TableCell>
                <TableCell>
                  <PersonName name={expense.loggedBy.name} />
                </TableCell>
                {manage && (
                  <TableCell className="text-end">
                    <span className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('invoices.expenses.editOf', { name: expense.description })}
                        onClick={() => setEditing(expense)}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('invoices.expenses.archiveOf', {
                          name: expense.description,
                        })}
                        onClick={() => setArchiving(expense)}
                      >
                        <ArchiveIcon />
                      </Button>
                    </span>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {manage && (
        <>
          <ExpenseDialog
            projectId={billing.project.id}
            projectCurrency={billing.project.currency}
            open={adding}
            onClose={() => setAdding(false)}
          />
          <ExpenseDialog
            key={editing?.id}
            projectId={billing.project.id}
            projectCurrency={billing.project.currency}
            expense={editing ?? undefined}
            open={editing !== null}
            onClose={() => setEditing(null)}
          />
          <ConfirmDialog
            open={archiving !== null}
            onClose={() => setArchiving(null)}
            title={t('invoices.expenses.archiveTitle', { name: archiving?.description ?? '' })}
            body={t('invoices.expenses.archiveBody')}
            action={t('invoices.expenses.archive')}
            destructive
            pending={archive.isPending}
            onConfirm={async () => {
              if (archiving) await archive.mutateAsync(archiving.id);
            }}
          />
        </>
      )}
    </BillingSection>
  );
}

/** A titled block of a Billing tab, with an optional action beside the title. */
export function BillingSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function BillingSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {['a', 'b', 'c', 'd'].map((key) => (
          <Skeleton key={key} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-48" />
      <Skeleton className="h-32" />
    </div>
  );
}
