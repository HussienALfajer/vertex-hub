import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { RetainerDetail, RetainerTemplate } from '@vertex-hub/contracts';
import {
  Button,
  Callout,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from '@vertex-hub/ui';
import { CalendarSyncIcon, LayersIcon, ListPlusIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { lineName } from '../retainers/retainer-badges';
import { GenerateTasksDialog } from './generate-dialog';
import { RunSentence } from './template-runs';
import {
  retainerTemplateQuery,
  templateListQuery,
  useGenerateMissingTasks,
  useSetRetainerTemplate,
} from './templates.queries';

/** Rules 17 and 19: links and manual runs need a retainer that is neither archived nor ended. */
const isOpen = (retainer: RetainerDetail) =>
  retainer.archivedAt === null && retainer.status !== 'ended';

/**
 * Spec screen 6, This month tab: the linked monthly template with its edit action, and this
 * cycle's run, or "Generate this month's tasks" while the cycle has none.
 */
export function RetainerTemplatePanel({ retainer }: { retainer: RetainerDetail }) {
  const { t } = useTranslation();
  const state = useQuery(retainerTemplateQuery(retainer.id));
  const [dialog, setDialog] = useState<'link' | 'generate' | null>(null);

  if (state.isPending) return <Skeleton className="h-16" />;
  if (state.isError) {
    return (
      <LoadError message={t('templates.retainer.loadError')} onRetry={() => state.refetch()} />
    );
  }
  const { template, cycle, run, permissions } = state.data;
  const canLink = permissions.canLink && isOpen(retainer);
  const canGenerate = permissions.canGenerate && isOpen(retainer) && !!cycle && !run;

  return (
    <section
      aria-label={t('templates.retainer.title')}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <CalendarSyncIcon aria-hidden="true" className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-xs text-muted-foreground">{t('templates.retainer.title')}</p>
          {template ? (
            <Link
              to="/templates/$templateId"
              params={{ templateId: template.id }}
              className="w-fit font-bold hover:underline"
            >
              {template.name}
            </Link>
          ) : (
            <p className="text-muted-foreground">{t('templates.retainer.none')}</p>
          )}
        </div>
        {canGenerate && (
          <Button size="sm" onClick={() => setDialog('generate')}>
            <LayersIcon />
            {t('templates.retainer.generate')}
          </Button>
        )}
        {canLink && (
          <Button size="sm" variant="outline" onClick={() => setDialog('link')}>
            {template ? t('templates.retainer.change') : t('templates.retainer.link')}
          </Button>
        )}
      </div>
      {template?.archived && (
        <Callout
          tone="warning"
          icon={<TriangleAlertIcon />}
          title={t('templates.retainer.archivedTitle')}
          description={t('templates.retainer.archivedBody')}
        />
      )}
      {run ? (
        <p className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
          <LayersIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <RunSentence run={run} />
          <span className="text-muted-foreground">
            ·{' '}
            {t('templates.generate.taskCount', {
              count: run.taskCount,
              n: formatNumber(run.taskCount),
            })}
          </span>
        </p>
      ) : (
        template &&
        cycle &&
        !template.archived && (
          <p className="border-t border-border pt-3 text-sm text-muted-foreground">
            {t('templates.retainer.notGenerated')}
          </p>
        )
      )}
      <LinkTemplateDialog
        retainer={retainer}
        current={template}
        open={dialog === 'link'}
        onClose={() => setDialog(null)}
      />
      {template && cycle && (
        <GenerateTasksDialog
          target={{
            type: 'cycle',
            cycleId: cycle.id,
            templateId: template.id,
            lines: state.data.lines,
          }}
          open={dialog === 'generate'}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}

/**
 * A cycle line's task count against its committed quantity, with "Generate N missing tasks" when
 * the linked template has a repeated step for it (rule 18).
 */
export function LineTemplateTasks({
  retainerId,
  cycleId,
  line,
  canGenerate,
}: {
  retainerId: string;
  cycleId: string;
  line: RetainerTemplate['lines'][number];
  canGenerate: boolean;
}) {
  const { t } = useTranslation();
  const generate = useGenerateMissingTasks(retainerId, cycleId);

  async function run() {
    try {
      const result = await generate.mutateAsync(line.id);
      toast.add({
        title: t('templates.generate.done', {
          count: result.taskCount,
          n: formatNumber(result.taskCount),
        }),
        type: 'success',
      });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted-foreground tabular-nums">
        {t('templates.lines.tasks', {
          tasks: formatNumber(line.tasks),
          committed: formatNumber(line.committed),
        })}
      </span>
      {canGenerate && line.canGenerate && line.missing > 0 && (
        <Button variant="outline" size="sm" disabled={generate.isPending} onClick={run}>
          <ListPlusIcon />
          {t('templates.lines.generateMissing', {
            count: line.missing,
            n: formatNumber(line.missing),
            name: lineName(t, line),
          })}
        </Button>
      )}
    </div>
  );
}

const NONE = 'none';

/** Rule 19: the monthly template applies from the next cycle; unlinking stops the runs. */
function LinkTemplateDialog({
  retainer,
  current,
  open,
  onClose,
}: {
  retainer: RetainerDetail;
  /** The linked template; an archived one is kept as an option until another is picked. */
  current: RetainerTemplate['template'];
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [choice, setChoice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const templates = useQuery({
    ...templateListQuery({ kind: 'retainer_cycle', pageSize: 100 }),
    enabled: open,
  });
  const link = useSetRetainerTemplate();
  const value = choice ?? current?.id ?? NONE;
  const items = [
    { value: NONE, label: t('templates.picker.none') },
    ...(templates.data?.items ?? []).map((item) => ({ value: item.id, label: item.name })),
  ];
  if (current?.archived) {
    items.push({
      value: current.id,
      label: t('templates.retainer.archivedOption', { name: current.name }),
    });
  }

  function close() {
    setChoice(null);
    setFailure(null);
    onClose();
  }

  async function save() {
    setFailure(null);
    try {
      await link.mutateAsync({
        retainerId: retainer.id,
        templateId: value === NONE ? null : value,
      });
      toast.add({ title: t('templates.retainer.saved'), type: 'success' });
      close();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent closeLabel={t('common.close')}>
        <div className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t('templates.retainer.linkTitle', { name: retainer.name })}</DialogTitle>
            <DialogDescription>{t('templates.retainer.linkHint')}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel id={id} render={<span />}>
              {t('templates.picker.monthly')}
            </FieldLabel>
            <Select items={items} value={value} onValueChange={(next) => next && setChoice(next)}>
              <SelectTrigger aria-labelledby={id}>
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
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="button" disabled={link.isPending} onClick={save}>
              {link.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
