import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TemplateDetail } from '@vertex-hub/contracts';
import {
  Field,
  FieldDescription,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@vertex-hub/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errors';
import { templateListQuery, templateQuery } from './templates.queries';

const NONE = 'none';

/**
 * Spec screen 4: a project template for the new project, handed over with its stages and steps so
 * the form can turn them into milestones (`stageMilestones`); the project page then opens the
 * generate dialog with it.
 */
export function ProjectTemplateField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (template: TemplateDetail | null) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const templates = useQuery(templateListQuery({ kind: 'project', pageSize: 100 }));
  const [failure, setFailure] = useState<string | null>(null);
  const items = [
    { value: NONE, label: t('templates.picker.none') },
    ...(templates.data?.items ?? []).map((item) => ({ value: item.id, label: item.name })),
  ];

  async function pick(next: string) {
    setFailure(null);
    if (next === NONE) {
      onChange(null);
      return;
    }
    try {
      onChange(await queryClient.fetchQuery(templateQuery(next)));
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <Field invalid={!!failure}>
      <FieldLabel id={id} render={<span />}>
        {t('templates.picker.project')}
      </FieldLabel>
      <Select items={items} value={value ?? NONE} onValueChange={(next) => next && pick(next)}>
        <SelectTrigger aria-labelledby={id} className="sm:max-w-sm">
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
      <FieldDescription>{t('templates.picker.projectHint')}</FieldDescription>
      {failure && (
        <p role="alert" className="text-sm text-destructive-text">
          {failure}
        </p>
      )}
    </Field>
  );
}

/** Spec screen 6: the new retainer's monthly template, linked right after it is created. */
export function MonthlyTemplateField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (templateId: string | null) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const templates = useQuery(templateListQuery({ kind: 'retainer_cycle', pageSize: 100 }));
  const items = [
    { value: NONE, label: t('templates.picker.none') },
    ...(templates.data?.items ?? []).map((item) => ({ value: item.id, label: item.name })),
  ];
  return (
    <Field>
      <FieldLabel id={id} render={<span />}>
        {t('templates.picker.monthly')}
      </FieldLabel>
      <Select
        items={items}
        value={value ?? NONE}
        onValueChange={(next) => next && onChange(next === NONE ? null : next)}
      >
        <SelectTrigger aria-labelledby={id} className="sm:max-w-sm">
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
      <FieldDescription>{t('templates.picker.monthlyHint')}</FieldDescription>
    </Field>
  );
}
