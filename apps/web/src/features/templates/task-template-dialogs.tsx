import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import {
  businessDate,
  type TaskTemplateDraft,
  type TemplateFromTask,
  type TemplateFromTaskInput,
  templateFromTaskSchema,
} from '@vertex-hub/contracts';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  RadioCard,
  RadioGroup,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { LayersIcon } from 'lucide-react';
import { type ComponentProps, useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { errorMessage, errorRole, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import {
  templateListQuery,
  useSaveTaskAsTemplate,
  useTaskTemplateDraft,
} from './templates.queries';

/**
 * F06B rule D2: "Start from a template" in the wizard. The chosen task template comes back as a
 * draft dated in work days from the start date, with the default assignees the user may set.
 */
export function StartFromTemplateDialog({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (draft: TaskTemplateDraft) => void;
}) {
  const { t } = useTranslation();
  const ids = { list: useId(), start: useId() };
  const templates = useQuery({
    ...templateListQuery({ kind: 'task', pageSize: 100 }),
    enabled: open,
  });
  const draft = useTaskTemplateDraft();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(businessDate());
  const [failure, setFailure] = useState<string | null>(null);
  const items = templates.data?.items ?? [];

  async function apply() {
    if (!templateId) return;
    setFailure(null);
    try {
      onApply(await draft.mutateAsync({ id: templateId, startDate: startDate || undefined }));
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('tasks.wizard.template.title')}</DialogTitle>
          <DialogDescription>{t('tasks.wizard.template.body')}</DialogDescription>
        </DialogHeader>
        {templates.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : templates.isError ? (
          <LoadError message={t('templates.loadError')} onRetry={() => templates.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<LayersIcon />}
            title={t('tasks.wizard.template.emptyTitle')}
            description={t('tasks.wizard.template.emptyHint')}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span id={ids.list} className="text-sm font-medium">
                {t('tasks.wizard.template.pick')}
              </span>
              <RadioGroup<string>
                aria-labelledby={ids.list}
                value={templateId ?? ''}
                onValueChange={(next) => setTemplateId(next)}
                className="max-h-72 overflow-y-auto"
              >
                {items.map((template) => (
                  <RadioCard<string>
                    key={template.id}
                    value={template.id}
                    title={template.name}
                    description={[
                      template.description,
                      t('tasks.wizard.template.subtasks', {
                        n: formatNumber(Math.max(0, template.stepCount - 1)),
                      }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                ))}
              </RadioGroup>
            </div>
            <Field>
              <FieldLabel htmlFor={ids.start}>{t('tasks.wizard.template.startDate')}</FieldLabel>
              <Input
                id={ids.start}
                type="date"
                dir="ltr"
                min={businessDate()}
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="sm:max-w-48"
              />
              <FieldDescription>{t('tasks.wizard.template.startHint')}</FieldDescription>
            </Field>
          </div>
        )}
        {failure && <FormAlert>{failure}</FormAlert>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>
            {t('common.cancel')}
          </DialogClose>
          <Button
            type="button"
            disabled={!templateId || draft.isPending}
            focusableWhenDisabled
            onClick={apply}
          >
            <LayersIcon />
            {draft.isPending
              ? t('tasks.wizard.template.applying')
              : t('tasks.wizard.template.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * F06B rule D1: "Save as template" on a top-level task, for assign-scope holders: its brief,
 * fields, run mode, stages and subtasks in order; the assignees only with "keep assignees".
 */
export function SaveAsTemplateDialog({
  task,
  open,
  onClose,
  finalFocus,
}: {
  task: { id: string; title: string };
  open: boolean;
  onClose: () => void;
  /** Where the focus goes when it closes: the menu item that opened it is gone. */
  finalFocus?: ComponentProps<typeof DialogContent>['finalFocus'];
}) {
  const { t } = useTranslation();
  const ids = { name: useId(), description: useId(), keep: useId() };
  const save = useSaveTaskAsTemplate(task.id);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<TemplateFromTaskInput, unknown, TemplateFromTask>({
    resolver: standardSchemaResolver(templateFromTaskSchema),
    defaultValues: { name: task.title.slice(0, 80), description: '', keepAssignees: false },
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      const template = await save.mutateAsync(values);
      toast.add({
        title: t('tasks.wizard.template.saved', { name: template.name }),
        type: 'success',
      });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'TEMPLATE_NAME_TAKEN') {
        form.setError(
          'name',
          { type: SCREEN_ERROR, message: errorMessage(t, error) },
          { shouldFocus: true },
        );
        return;
      }
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onOpenChangeComplete={(next) => {
        if (next) return;
        form.reset();
        setFailure(null);
      }}
    >
      <DialogContent closeLabel={t('common.close')} finalFocus={finalFocus}>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('tasks.wizard.template.saveTitle')}</DialogTitle>
            <DialogDescription>{t('tasks.wizard.template.saveBody')}</DialogDescription>
          </DialogHeader>
          <Field invalid={!!errors.name}>
            <FieldLabel htmlFor={ids.name}>{t('templates.form.name')}</FieldLabel>
            <Input id={ids.name} autoComplete="off" maxLength={80} {...form.register('name')} />
            <FieldError match={!!errors.name} role={errorRole(errors.name)}>
              {fieldError(errors.name, t('templates.form.errors.name'))}
            </FieldError>
          </Field>
          <Field invalid={!!errors.description}>
            <FieldLabel htmlFor={ids.description}>{t('templates.form.description')}</FieldLabel>
            <Textarea
              id={ids.description}
              rows={3}
              placeholder={t('templates.form.descriptionPlaceholder')}
              {...form.register('description')}
            />
            <FieldError match={!!errors.description}>
              {t('templates.form.errors.description')}
            </FieldError>
          </Field>
          <Field>
            <label htmlFor={ids.keep} className="flex items-center gap-3">
              <Controller
                control={form.control}
                name="keepAssignees"
                render={({ field }) => (
                  <Switch
                    id={ids.keep}
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <span className="text-sm font-medium">
                {t('tasks.wizard.template.keepAssignees')}
              </span>
            </label>
            <FieldDescription>{t('tasks.wizard.template.keepAssigneesHint')}</FieldDescription>
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('common.saving') : t('tasks.wizard.template.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
