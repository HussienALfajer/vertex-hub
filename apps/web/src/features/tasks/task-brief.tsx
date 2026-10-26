import type { TaskBriefFields, TaskDetail } from '@vertex-hub/contracts';
import { ColorSwatch, PlatformMark, RichTextView } from '@vertex-hub/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLinkHost, formatNumber } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { TaskSection } from './task-parts';

/** F06B rules C1 and C7: the brief as rich text, then the department's brief fields. */
export function BriefSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const hasBrief = task.briefDoc !== null || task.brief !== null;
  return (
    <TaskSection title={t('tasks.page.brief')}>
      {hasBrief ? (
        <BriefText task={task} />
      ) : (
        !task.briefFields && (
          <p className="text-sm text-muted-foreground">{t('tasks.page.noBrief')}</p>
        )
      )}
      {task.briefFields && <BriefFieldsView fields={task.briefFields} />}
      {task.estimateMinutes !== null && (
        <p className="text-sm text-muted-foreground">
          {t('tasks.brief.estimate', { hours: formatNumber(task.estimateMinutes / 60) })}
        </p>
      )}
    </TaskSection>
  );
}

function BriefFieldsView({ fields }: { fields: TaskBriefFields }) {
  const { t } = useTranslation();
  const rows: { key: keyof TaskBriefFields; value: ReactNode }[] = [];
  const add = (key: keyof TaskBriefFields, value: ReactNode) => rows.push({ key, value });
  if (fields.sizes?.length) add('sizes', <span dir="ltr">{fields.sizes.join(' · ')}</span>);
  if (fields.colors?.length) {
    add(
      'colors',
      <span className="flex flex-wrap items-center gap-2">
        {fields.colors.map((color) => (
          <span key={color} className="flex items-center gap-1">
            <ColorSwatch color={color} />
            <span dir="ltr" className="text-xs">
              {color}
            </span>
          </span>
        ))}
      </span>,
    );
  }
  if (fields.references?.length) {
    add(
      'references',
      <span className="flex flex-col gap-0.5">
        {fields.references.map((url) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            dir="ltr"
            className="w-fit text-primary hover:underline"
          >
            {formatLinkHost(url)}
          </a>
        ))}
      </span>,
    );
  }
  if (fields.length) add('length', fields.length);
  if (fields.aspectRatio) {
    add(
      'aspectRatio',
      fields.aspectRatio === 'other' ? (
        t('tasks.brief.otherRatio')
      ) : (
        <span dir="ltr">{fields.aspectRatio}</span>
      ),
    );
  }
  if (fields.music) add('music', fields.music);
  if (fields.link) {
    add(
      'link',
      <a
        href={fields.link}
        target="_blank"
        rel="noopener noreferrer"
        dir="ltr"
        className="text-primary hover:underline"
      >
        {formatLinkHost(fields.link)}
      </a>,
    );
  }
  if (fields.environment) add('environment', t(`tasks.brief.environments.${fields.environment}`));
  if (fields.platforms?.length) {
    add(
      'platforms',
      <span className="flex flex-wrap items-center gap-2">
        {fields.platforms.map((platform) => (
          <span key={platform} className="flex items-center gap-1">
            <PlatformMark platform={platform} size="sm" />
            {t(`clients.platforms.names.${platform}`)}
          </span>
        ))}
      </span>,
    );
  }
  if (fields.tone) add('tone', fields.tone);
  if (fields.goal) add('goal', fields.goal);
  if (fields.audience) add('audience', fields.audience);
  if (fields.budget) {
    add('budget', formatMoney(fields.budget.amountMinor, fields.budget.currency));
  }
  if (rows.length === 0) return null;
  return (
    <dl className="grid gap-3 border-t border-border pt-3 text-sm sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.key} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{t(`tasks.brief.fields.${row.key}`)}</dt>
          <dd className="min-w-0">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The brief as rich text, or as plain lines for a brief written before F06B. */
function BriefText({ task }: { task: Pick<TaskDetail, 'brief' | 'briefDoc'> }) {
  if (task.briefDoc) return <RichTextView doc={task.briefDoc} className="max-w-prose" />;
  return task.brief ? (
    <p className="max-w-prose text-base whitespace-pre-line">{task.brief}</p>
  ) : null;
}
