import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TemplateDetail } from '@vertex-hub/contracts';
import { Avatar, Button, Callout, PageHeader, Skeleton, toast } from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightIcon,
  RepeatIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { isMissing, LoadError } from '../../components/load-error';
import { UnsavedChangesGuard } from '../../components/unsaved-changes-guard';
import { formatDateTime, formatList, formatNumber } from '../../lib/format';
import { useDepartmentNames } from '../projects/project-badges';
import { TemplateKindBadge } from './template-badges';
import { templateFormValues } from './template-document';
import {
  AssigneesEditor,
  BasicsFields,
  StepsEditor,
  templateFormFailure,
  useTemplateForm,
} from './template-editor';
import {
  templateQuery,
  useArchiveTemplate,
  useRestoreTemplate,
  useUpdateTemplate,
} from './templates.queries';

export function TemplatePage({ templateId }: { templateId: string }) {
  const { t } = useTranslation();
  const template = useQuery(templateQuery(templateId));
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/templates" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('templates.back')}
        </Button>
      </div>
      {template.isPending ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-40" />
          <Skeleton className="h-72" />
        </div>
      ) : template.isError ? (
        <LoadError
          message={
            isMissing(template.error) ? t('templates.notFound') : t('templates.loadOneError')
          }
          onRetry={() => template.refetch()}
          error={template.error}
        />
      ) : (
        <TemplateHost template={template.data} />
      )}
    </>
  );
}

/**
 * Holds the stored version the form started from. A refetch (another editor saved, or the
 * window regained focus) never restarts the form under unsaved work: the editor offers the newer
 * version instead. The form starts again from the user's own save (new step ids), and when the
 * template is archived or restored (read-only changes).
 */
function TemplateHost({ template }: { template: TemplateDetail }) {
  const [base, setBase] = useState(template);
  if (base.archivedAt !== template.archivedAt) setBase(template);
  return (
    <Template
      key={`${base.updatedAt}:${base.archivedAt ?? ''}`}
      base={base}
      template={template}
      onLoad={setBase}
    />
  );
}

/** The template as one document: editors change it and save it whole, readers see it read-only. */
function Template({
  base,
  template,
  onLoad,
}: {
  /** The version the form started from. */
  base: TemplateDetail;
  /** The latest stored version. */
  template: TemplateDetail;
  /** Starts the form again from a stored version. */
  onLoad: (version: TemplateDetail) => void;
}) {
  const { t } = useTranslation();
  const readOnly = !template.permissions.canEdit;
  const form = useTemplateForm(templateFormValues(base));
  const update = useUpdateTemplate(template.id);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'archive' | 'restore' | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const departmentName = useDepartmentNames();
  const dirty = form.formState.isDirty;
  // Later only: right after the own save, the cached template may still be the older one.
  const newer = template.updatedAt > base.updatedAt;

  // Nothing to lose: take the newer version at once.
  useEffect(() => {
    if (newer && !dirty && !form.formState.isSubmitting) onLoad(template);
  }, [newer, dirty, form.formState.isSubmitting, onLoad, template]);

  const submit = form.handleSubmit(async ({ kind: _, ...values }) => {
    setFailure(null);
    try {
      const saved = await update.mutateAsync(values);
      toast.add({ title: t('templates.saved'), type: 'success' });
      onLoad(saved);
    } catch (error) {
      setFailure(templateFormFailure(form, t, error));
    }
  });

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {template.name}
            <TemplateKindBadge kind={template.kind} />
          </span>
        }
        description={template.description ?? undefined}
        actions={
          template.permissions.canArchive &&
          (template.archivedAt ? (
            <Button variant="outline" onClick={() => setConfirm('restore')}>
              <ArchiveRestoreIcon />
              {t('templates.restore')}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setConfirm('archive')}>
              <ArchiveIcon />
              {t('templates.archive')}
            </Button>
          ))
        }
      />

      {template.archivedAt && (
        <Callout
          icon={<ArchiveIcon />}
          title={t('templates.archivedTitle')}
          description={t('templates.archivedBody', { when: formatDateTime(template.archivedAt) })}
        />
      )}
      {template.warnings.length > 0 && (
        <Callout
          tone="warning"
          icon={<TriangleAlertIcon />}
          title={t('templates.warningsTitle')}
          description={t('templates.warningsBody', {
            departments: formatList(template.warnings.map((w) => departmentName(w.department))),
          })}
        />
      )}

      {newer && dirty && (
        <Callout
          tone="warning"
          icon={<TriangleAlertIcon />}
          title={t('templates.changedTitle')}
          description={t('templates.changedBody', { when: formatDateTime(template.updatedAt) })}
          action={
            <Button variant="outline" size="sm" onClick={() => onLoad(template)}>
              {t('templates.loadLatest')}
            </Button>
          }
        />
      )}

      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        {!readOnly && (
          <FormSection title={t('templates.form.basics')} hint={t('templates.form.basicsHint')}>
            <BasicsFields form={form} isNew={false} />
          </FormSection>
        )}
        <FormSection
          title={t('templates.form.steps')}
          hint={
            template.kind === 'project'
              ? t('templates.form.stepsHint')
              : t('templates.form.stepsCycleHint')
          }
        >
          <StepsEditor form={form} readOnly={readOnly} />
        </FormSection>
        <FormSection title={t('templates.form.assignees')} hint={t('templates.form.assigneesHint')}>
          <AssigneesEditor form={form} stored={template.assignees} readOnly={readOnly} />
        </FormSection>
        {template.kind === 'retainer_cycle' && <LinkedRetainers template={template} />}
        {!readOnly && (
          <>
            {failure && <FormAlert>{failure}</FormAlert>}
            <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-background px-4 py-3 md:-mx-8 md:px-8">
              {form.formState.isDirty && (
                <p className="me-auto text-sm text-muted-foreground">{t('templates.unsaved')}</p>
              )}
              <Button
                variant="outline"
                disabled={!form.formState.isDirty || form.formState.isSubmitting}
                onClick={() => setConfirmDiscard(true)}
              >
                {t('templates.discard')}
              </Button>
              <Button
                type="submit"
                disabled={!form.formState.isDirty || form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? t('common.saving') : t('templates.save')}
              </Button>
            </div>
          </>
        )}
      </form>

      <ArchiveDialogs template={template} open={confirm} onClose={() => setConfirm(null)} />
      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title={t('common.unsaved.title')}
        body={t('templates.discardBody')}
        action={t('common.unsaved.discard')}
        destructive
        pending={false}
        onConfirm={async () => {
          setFailure(null);
          form.reset();
        }}
      />
      <UnsavedChangesGuard dirty={dirty && !form.formState.isSubmitting} />
    </>
  );
}

function LinkedRetainers({ template }: { template: TemplateDetail }) {
  const { t } = useTranslation();
  const retainers = template.linkedRetainers;
  return (
    <FormSection
      title={t('templates.linked.title')}
      hint={t('templates.linked.hint', {
        n: formatNumber(retainers.length),
      })}
    >
      {retainers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('templates.linked.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {retainers.map((retainer) => (
            <li key={retainer.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={retainer.client.name} shape="square" size="sm" />
              <div className="flex min-w-0 flex-col">
                <Link
                  to="/retainers/$retainerId"
                  params={{ retainerId: retainer.id }}
                  className="truncate font-medium hover:underline"
                >
                  {retainer.name}
                </Link>
                <span className="truncate text-sm text-muted-foreground">
                  {retainer.client.name}
                </span>
              </div>
              <RepeatIcon aria-hidden="true" className="ms-auto size-4 text-muted-foreground" />
            </li>
          ))}
        </ul>
      )}
    </FormSection>
  );
}

function ArchiveDialogs({
  template,
  open,
  onClose,
}: {
  template: TemplateDetail;
  open: 'archive' | 'restore' | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const archive = useArchiveTemplate(template.id);
  const restore = useRestoreTemplate(template.id);
  const linked = template.linkedRetainers.length;
  return (
    <>
      <ConfirmDialog
        open={open === 'archive'}
        onClose={onClose}
        title={t('templates.archiveTitle', { name: template.name })}
        body={
          linked > 0
            ? t('templates.archiveBodyLinked', { n: formatNumber(linked) })
            : t('templates.archiveBody')
        }
        action={t('templates.archive')}
        destructive
        pending={archive.isPending}
        onConfirm={async () => {
          await archive.mutateAsync();
          toast.add({ title: t('templates.archivedToast'), type: 'success' });
        }}
      />
      <ConfirmDialog
        open={open === 'restore'}
        onClose={onClose}
        title={t('templates.restoreTitle', { name: template.name })}
        body={t('templates.restoreBody')}
        action={t('templates.restore')}
        pending={restore.isPending}
        onConfirm={async () => {
          await restore.mutateAsync();
          toast.add({ title: t('templates.restoredToast'), type: 'success' });
        }}
      />
    </>
  );
}
