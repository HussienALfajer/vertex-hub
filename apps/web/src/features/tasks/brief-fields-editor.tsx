import {
  ASPECT_RATIOS,
  CURRENCIES,
  type Currency,
  DEPARTMENT_BRIEF_KINDS,
  DEVELOPMENT_ENVIRONMENTS,
  type DepartmentCode,
  POST_PLATFORMS,
  type PostPlatform,
  type TaskBriefFields,
} from '@vertex-hub/contracts';
import {
  ColorSwatch,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  MultiCombobox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@vertex-hub/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoneyInput } from '../../components/money-input';

/*
 * F06B rule C7: the brief fields of the chosen department, all optional, fixed per department in
 * the contracts. Other departments have none and the editor shows nothing.
 */

type Fields = TaskBriefFields;

/** Drops empty values, so an untouched editor sends null. */
function compact(fields: Fields): Fields | null {
  const entries = Object.entries(fields).filter(
    ([, value]) =>
      value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0),
  );
  return entries.length === 0 ? null : (Object.fromEntries(entries) as Fields);
}

/** Whether the department has brief fields at all. */
export function hasBriefFields(department: DepartmentCode | null | undefined): boolean {
  return !!department && DEPARTMENT_BRIEF_KINDS[department] !== undefined;
}

export function BriefFieldsEditor({
  department,
  value,
  onChange,
  invalid,
}: {
  department: DepartmentCode | null | undefined;
  value: Fields | null | undefined;
  onChange: (fields: Fields | null) => void;
  /** The field the schema refused (`briefFieldProblem`), shown on that field. */
  invalid?: string | null;
}) {
  const { t } = useTranslation();
  const kind = department ? DEPARTMENT_BRIEF_KINDS[department] : undefined;
  if (!kind) return null;
  const fields = value ?? {};
  const set = <K extends keyof Fields>(key: K, next: Fields[K]) =>
    onChange(compact({ ...fields, [key]: next }));
  const error = (key: 'sizes' | 'colors' | 'references' | 'link') =>
    invalid === key ? t(`tasks.briefFields.errors.${key}`) : undefined;
  const shown = ['sizes', 'colors', 'references', 'link'];
  const text = (key: 'length' | 'music' | 'tone' | 'goal' | 'audience', max: number) => (
    <TextField
      key={key}
      label={t(`tasks.brief.fields.${key}`)}
      value={fields[key] ?? ''}
      maxLength={max}
      onChange={(next) => set(key, next.trim() ? next : undefined)}
    />
  );
  return (
    <fieldset className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
      <legend className="px-1 text-sm font-medium">{t('tasks.briefFields.title')}</legend>
      {kind === 'design' && (
        <>
          <ListField
            label={t('tasks.brief.fields.sizes')}
            hint={t('tasks.briefFields.sizesHint')}
            value={fields.sizes ?? []}
            onChange={(next) => set('sizes', next)}
            error={error('sizes')}
          />
          <ColorsField
            value={fields.colors ?? []}
            onChange={(next) => set('colors', next)}
            error={error('colors')}
          />
          <ListField
            label={t('tasks.brief.fields.references')}
            hint={t('tasks.briefFields.referencesHint')}
            value={fields.references ?? []}
            onChange={(next) => set('references', next)}
            error={error('references')}
            ltr
          />
        </>
      )}
      {kind === 'photography' && (
        <>
          {text('length', 40)}
          <ChoiceField
            label={t('tasks.brief.fields.aspectRatio')}
            options={ASPECT_RATIOS.map((ratio) => ({
              value: ratio,
              label: ratio === 'other' ? t('tasks.brief.otherRatio') : ratio,
            }))}
            value={fields.aspectRatio}
            onChange={(next) => set('aspectRatio', next)}
          />
          {text('music', 200)}
        </>
      )}
      {kind === 'development' && (
        <>
          <TextField
            label={t('tasks.brief.fields.link')}
            value={fields.link ?? ''}
            ltr
            type="url"
            onChange={(next) => set('link', next.trim() ? next.trim() : undefined)}
            error={error('link')}
          />
          <ChoiceField
            label={t('tasks.brief.fields.environment')}
            options={DEVELOPMENT_ENVIRONMENTS.map((environment) => ({
              value: environment,
              label: t(`tasks.brief.environments.${environment}`),
            }))}
            value={fields.environment}
            onChange={(next) => set('environment', next)}
          />
        </>
      )}
      {kind === 'content' && (
        <>
          <PlatformsField
            value={fields.platforms ?? []}
            onChange={(next) => set('platforms', next)}
          />
          {text('tone', 200)}
          {text('length', 100)}
        </>
      )}
      {kind === 'marketing' && (
        <>
          {text('goal', 300)}
          {text('audience', 300)}
          <BudgetField value={fields.budget} onChange={(next) => set('budget', next)} />
        </>
      )}
      {invalid && !shown.includes(invalid) && (
        <p role="alert" className="text-sm text-destructive-text sm:col-span-2">
          {t('tasks.briefFields.errors.other')}
        </p>
      )}
    </fieldset>
  );
}

function TextField({
  label,
  value,
  onChange,
  maxLength,
  ltr,
  type,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  ltr?: boolean;
  type?: string;
  error?: string;
}) {
  const id = useId();
  return (
    <Field invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        dir={ltr ? 'ltr' : undefined}
        autoComplete="off"
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError match={!!error}>{error}</FieldError>
    </Field>
  );
}

/** Values one per line; the typed text stays as typed until the value changes from outside. */
function ListField({
  label,
  hint,
  value,
  onChange,
  ltr,
  error,
}: {
  label: string;
  hint: string;
  value: string[];
  onChange: (value: string[]) => void;
  ltr?: boolean;
  error?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => ({ text: value.join('\n'), value }));
  if (draft.value.join('\n') !== value.join('\n')) setDraft({ text: value.join('\n'), value });
  return (
    <Field invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        rows={3}
        dir={ltr ? 'ltr' : undefined}
        value={draft.text}
        onChange={(event) => {
          const text = event.target.value;
          const next = text
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 10);
          setDraft({ text, value: next });
          onChange(next);
        }}
      />
      <FieldDescription>{hint}</FieldDescription>
      <FieldError match={!!error}>{error}</FieldError>
    </Field>
  );
}

function ColorsField({
  value,
  onChange,
  error,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <ListField
        label={t('tasks.brief.fields.colors')}
        hint={t('tasks.briefFields.colorsHint')}
        value={value}
        onChange={onChange}
        error={error}
        ltr
      />
      {value.some((color) => /^#[0-9a-fA-F]{6}$/.test(color)) && (
        <span className="flex flex-wrap gap-2">
          {value
            .filter((color) => /^#[0-9a-fA-F]{6}$/.test(color))
            .map((color) => (
              <ColorSwatch key={color} color={color} />
            ))}
        </span>
      )}
    </div>
  );
}

function ChoiceField<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | undefined;
  onChange: (value: T | undefined) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const none = { value: '', label: t('tasks.briefFields.none') };
  return (
    <Field>
      <FieldLabel id={id} render={<span />}>
        {label}
      </FieldLabel>
      <Select
        items={[none, ...options]}
        value={value ?? ''}
        onValueChange={(next) => onChange(next ? (next as T) : undefined)}
      >
        <SelectTrigger aria-labelledby={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[none, ...options].map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function PlatformsField({
  value,
  onChange,
}: {
  value: PostPlatform[];
  onChange: (value: PostPlatform[]) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const items = POST_PLATFORMS.map((platform) => ({
    platform,
    name: t(`clients.platforms.names.${platform}`),
  }));
  return (
    <Field className="sm:col-span-2">
      <FieldLabel htmlFor={id}>{t('tasks.brief.fields.platforms')}</FieldLabel>
      <MultiCombobox
        id={id}
        items={items}
        value={items.filter((item) => value.includes(item.platform))}
        onValueChange={(next) => onChange(next.map((item) => item.platform))}
        itemToLabel={(item) => item.name}
        itemToKey={(item) => item.platform}
        placeholder={t('tasks.briefFields.platformsPlaceholder')}
        emptyLabel={t('common.noMatches')}
        removeLabel={(label) => t('common.remove', { label })}
      />
    </Field>
  );
}

function BudgetField({
  value,
  onChange,
}: {
  value: Fields['budget'];
  onChange: (value: Fields['budget']) => void;
}) {
  const { t } = useTranslation();
  const ids = { amount: useId(), currency: useId() };
  // Chosen before the amount, the currency waits here for it.
  const [chosen, setChosen] = useState<Currency>(value?.currency ?? 'USD');
  const currency: Currency = value?.currency ?? chosen;
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2 sm:col-span-2">
      <Field>
        <FieldLabel htmlFor={ids.amount}>{t('tasks.brief.fields.budget')}</FieldLabel>
        <MoneyInput
          id={ids.amount}
          currency={currency}
          value={value?.amountMinor ?? null}
          onValueChange={(amountMinor) =>
            onChange(amountMinor === null ? undefined : { amountMinor, currency })
          }
        />
      </Field>
      <Field>
        <FieldLabel id={ids.currency} render={<span />}>
          {t('tasks.briefFields.currency')}
        </FieldLabel>
        <Select
          items={CURRENCIES.map((code) => ({ value: code, label: code }))}
          value={currency}
          onValueChange={(next) => {
            if (!next) return;
            setChosen(next as Currency);
            if (value) onChange({ ...value, currency: next as Currency });
          }}
        >
          <SelectTrigger aria-labelledby={ids.currency} className="w-24" dir="ltr">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((code) => (
              <SelectItem key={code} value={code}>
                {code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

/**
 * The brief field a form error names: the schema's issue paths end in the field
 * (`briefFields.colors.0`, or `briefFields.<field>` from the department check).
 */
export function briefFieldProblem(errors: unknown): string | null {
  if (!errors || typeof errors !== 'object') return null;
  const key = Object.keys(errors).find(
    (name) => !['message', 'type', 'ref', 'root'].includes(name),
  );
  if (key) return key;
  return 'message' in errors ? 'other' : null;
}
