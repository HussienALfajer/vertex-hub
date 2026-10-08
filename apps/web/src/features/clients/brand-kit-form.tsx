import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  BRAND_FILE_KINDS,
  type ClientDetailResponse,
  REFERENCE_KINDS,
  type UpdateBrandKit,
  type UpdateBrandKitInput,
  updateBrandKitSchema,
} from '@vertex-hub/contracts';
import {
  Button,
  ColorInput,
  Field,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  MultiCombobox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import {
  BanIcon,
  FileTextIcon,
  ImageIcon,
  type LucideIcon,
  MessageSquareQuoteIcon,
  PaletteIcon,
  PlusIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  Trash2Icon,
  TypeIcon,
} from 'lucide-react';
import { type ReactNode, type Ref, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { TabHeader } from '../../components/tab-header';
import { UnsavedChangesGuard } from '../../components/unsaved-changes-guard';
import { errorMessage } from '../../lib/errors';
import { focusAfterRemoval } from '../../lib/focus-after-removal';
import { useFocusFirstError } from '../../lib/focus-first-invalid';
import { useReplaceBrandKit } from './clients.queries';

/** List limits of `updateBrandKitSchema`: the "Add" buttons stop there, so a list never exceeds them. */
const LIMITS = { colors: 20, files: 30, references: 50 } as const;

type KitForm = ReturnType<typeof useForm<UpdateBrandKitInput, unknown, UpdateBrandKit>>;

/** The whole brand kit in one form: it is read and replaced as a whole. */
export function BrandKitForm({
  client,
  onDone,
}: {
  client: ClientDetailResponse;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const replace = useReplaceBrandKit(client.id);
  const [failure, setFailure] = useState<string | null>(null);
  const kit = client.brandKit;
  const heading = useRef<HTMLHeadingElement>(null);
  const formElement = useRef<HTMLFormElement>(null);
  const form: KitForm = useForm<UpdateBrandKitInput, unknown, UpdateBrandKit>({
    resolver: standardSchemaResolver(updateBrandKitSchema),
    // The form registers its own fields before its lists' controls: the hook below focuses the
    // first invalid control in page order instead.
    shouldFocusError: false,
    defaultValues: {
      colors: kit.colors.map((color) => ({ name: color.name ?? '', hex: color.hex })),
      fonts: kit.fonts,
      toneOfVoice: kit.toneOfVoice ?? '',
      forbiddenWords: kit.forbiddenWords,
      files: kit.files,
      references: kit.references.map((reference) => ({ ...reference, note: reference.note ?? '' })),
    },
  });
  // Read while rendering: React Hook Form updates only the state a component reads.
  const { errors, isDirty, submitCount } = form.formState;
  useFocusFirstError(submitCount, formElement);
  // The form replaces the tab's content, the button that opened it with it.
  useEffect(() => heading.current?.focus(), []);

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    // Nothing changed: close without a request or a "saved" toast.
    if (!isDirty) return onDone();
    try {
      await replace.mutateAsync(values);
      toast.add({ title: t('clients.brandKit.form.saved'), type: 'success' });
      onDone();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <form ref={formElement} className="flex flex-col gap-6" onSubmit={submit} noValidate>
      <TabHeader
        title={t('clients.brandKit.form.title')}
        description={t('clients.brandKit.form.subtitle')}
        headingRef={heading}
      />

      <Section
        icon={PaletteIcon}
        title={t('clients.brandKit.colors')}
        hint={t('clients.brandKit.form.colorsHint')}
      >
        <ColorsField form={form} />
      </Section>

      <Section
        icon={TypeIcon}
        title={t('clients.brandKit.fonts')}
        hint={t('clients.brandKit.form.fontsHint')}
      >
        <TextListField
          form={form}
          name="fonts"
          label={t('clients.brandKit.fonts')}
          placeholder={t('clients.brandKit.form.fontsPlaceholder')}
          error={t('clients.brandKit.form.errors.fonts')}
        />
      </Section>

      <Section icon={MessageSquareQuoteIcon} title={t('clients.brandKit.toneOfVoice')}>
        <Field invalid={!!errors.toneOfVoice}>
          <FieldLabel className="sr-only">{t('clients.brandKit.toneOfVoice')}</FieldLabel>
          <Textarea
            className="min-h-32"
            placeholder={t('clients.brandKit.form.tonePlaceholder')}
            {...form.register('toneOfVoice')}
          />
          <FieldError match={!!errors.toneOfVoice}>
            {t('clients.brandKit.form.errors.tone')}
          </FieldError>
        </Field>
      </Section>

      <Section
        icon={BanIcon}
        title={t('clients.brandKit.forbiddenWords')}
        hint={t('clients.brandKit.form.wordsHint')}
      >
        <TextListField
          form={form}
          name="forbiddenWords"
          label={t('clients.brandKit.forbiddenWords')}
          placeholder={t('clients.brandKit.form.wordsPlaceholder')}
          error={t('clients.brandKit.form.errors.forbiddenWords')}
        />
      </Section>

      <Section
        icon={FileTextIcon}
        title={t('clients.brandKit.files')}
        hint={t('clients.brandKit.form.filesHint')}
      >
        <FilesField form={form} />
      </Section>

      <Section
        icon={ImageIcon}
        title={t('clients.brandKit.references')}
        hint={t('clients.brandKit.form.referencesHint')}
      >
        <ReferencesField form={form} />
      </Section>

      {failure && <FormAlert>{failure}</FormAlert>}
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-background px-4 py-4 md:-mx-8 md:px-8">
        <Button variant="outline" type="button" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('common.saving') : t('clients.brandKit.form.save')}
        </Button>
      </div>
      <UnsavedChangesGuard dirty={form.formState.isDirty && !form.formState.isSubmitting} />
    </form>
  );
}

function Section({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 rounded-lg border border-border bg-surface p-6 lg:grid-cols-[14rem_1fr] lg:gap-8">
      <div className="flex flex-col gap-1">
        <h3 className="flex items-center gap-2 text-lg font-bold">
          <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
          {title}
        </h3>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </section>
  );
}

function AddButton({
  ref,
  onClick,
  disabled,
  children,
}: {
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="secondary"
      size="sm"
      className="self-start"
      onClick={onClick}
      disabled={disabled}
    >
      <PlusIcon />
      {children}
    </Button>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <IconButton size="icon" label={label} data-focus="remove" onClick={onClick}>
      <Trash2Icon />
    </IconButton>
  );
}

/**
 * A list's rows, its "add" button, and a removal that keeps the focus in the list (the next row's
 * remove button, the previous one, or "add").
 */
function useRows<Name extends 'colors' | 'files' | 'references'>(form: KitForm, name: Name) {
  const rows = useFieldArray({ control: form.control, name });
  const list = useRef<HTMLUListElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const remove = (index: number) => {
    flushSync(() => rows.remove(index));
    focusAfterRemoval(list.current, index, addButton.current);
  };
  return { ...rows, remove, list, addButton };
}

function ColorsField({ form }: { form: KitForm }) {
  const { t } = useTranslation();
  const { fields, append, remove, list, addButton } = useRows(form, 'colors');
  const errors = form.formState.errors.colors;
  return (
    <>
      {fields.length > 0 && (
        <ul ref={list} className="flex flex-col gap-3">
          {fields.map((item, index) => {
            const itemErrors = errors?.[index];
            return (
              <li key={item.id} className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-start">
                <Field invalid={!!itemErrors?.hex}>
                  <FieldLabel className="sr-only">{t('clients.brandKit.form.hex')}</FieldLabel>
                  <Controller
                    control={form.control}
                    name={`colors.${index}.hex`}
                    render={({ field }) => (
                      <ColorInput
                        inputRef={field.ref}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        pickLabel={t('clients.brandKit.form.pickColor')}
                        invalid={!!itemErrors?.hex}
                      />
                    )}
                  />
                  <FieldError match={!!itemErrors?.hex}>
                    {t('clients.brandKit.form.errors.hex')}
                  </FieldError>
                </Field>
                <Field invalid={!!itemErrors?.name}>
                  <FieldLabel className="sr-only">
                    {t('clients.brandKit.form.colorName')}
                  </FieldLabel>
                  <Input
                    placeholder={t('clients.brandKit.form.colorNamePlaceholder')}
                    {...form.register(`colors.${index}.name`)}
                  />
                  <FieldError match={!!itemErrors?.name}>
                    {t('clients.brandKit.form.errors.colorName')}
                  </FieldError>
                </Field>
                <RemoveButton
                  label={t('clients.brandKit.form.removeColor')}
                  onClick={() => remove(index)}
                />
              </li>
            );
          })}
        </ul>
      )}
      <AddButton
        ref={addButton}
        onClick={() => append({ hex: '', name: '' })}
        disabled={fields.length >= LIMITS.colors}
      >
        {t('clients.brandKit.form.addColor')}
      </AddButton>
    </>
  );
}

/** Short texts as chips (fonts, forbidden words): typed and added with Enter. */
function TextListField({
  form,
  name,
  label,
  placeholder,
  error,
}: {
  form: KitForm;
  name: 'fonts' | 'forbiddenWords';
  label: string;
  placeholder: string;
  error: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const invalid = !!form.formState.errors[name];
  return (
    <Field invalid={invalid}>
      <FieldLabel htmlFor={id} className="sr-only">
        {label}
      </FieldLabel>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <MultiCombobox<string>
            id={id}
            items={[]}
            value={field.value ?? []}
            onValueChange={field.onChange}
            itemToLabel={(text) => text}
            itemToKey={(text) => text.toLocaleLowerCase('ar')}
            placeholder={placeholder}
            emptyLabel={t('common.noMatches')}
            removeLabel={(text) => t('common.remove', { label: text })}
            create={{
              label: (text) => t('clients.brandKit.form.addText', { text }),
              toItem: (text) => text,
            }}
            invalid={invalid}
          />
        )}
      />
      <FieldError match={invalid}>{error}</FieldError>
    </Field>
  );
}

function FilesField({ form }: { form: KitForm }) {
  const { t } = useTranslation();
  const { fields, append, remove, list, addButton } = useRows(form, 'files');
  const errors = form.formState.errors.files;
  const kinds = BRAND_FILE_KINDS.map((kind) => ({
    value: kind,
    label: t(`clients.brandKit.fileKinds.${kind}`),
  }));
  return (
    <>
      {fields.length > 0 && (
        <ul ref={list} className="flex flex-col gap-3">
          {fields.map((item, index) => {
            const itemErrors = errors?.[index];
            return (
              <li
                key={item.id}
                className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[10rem_1fr_auto] sm:items-start"
              >
                <Field>
                  <FieldLabel>{t('clients.brandKit.form.fileKind')}</FieldLabel>
                  <Controller
                    control={form.control}
                    name={`files.${index}.kind`}
                    render={({ field }) => (
                      <Select items={kinds} value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="min-w-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {kinds.map((kind) => (
                            <SelectItem key={kind.value} value={kind.value}>
                              {kind.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
                <div className="grid gap-3">
                  <Field invalid={!!itemErrors?.label}>
                    <FieldLabel>{t('clients.brandKit.form.fileLabel')}</FieldLabel>
                    <Input
                      placeholder={t('clients.brandKit.form.fileLabelPlaceholder')}
                      {...form.register(`files.${index}.label`)}
                    />
                    <FieldError match={!!itemErrors?.label}>
                      {t('clients.brandKit.form.errors.label')}
                    </FieldError>
                  </Field>
                  <UrlField form={form} name={`files.${index}.url`} invalid={!!itemErrors?.url} />
                </div>
                <RemoveButton
                  label={t('clients.brandKit.form.removeFile')}
                  onClick={() => remove(index)}
                />
              </li>
            );
          })}
        </ul>
      )}
      <AddButton
        ref={addButton}
        onClick={() => append({ kind: 'logo', label: '', url: '' })}
        disabled={fields.length >= LIMITS.files}
      >
        {t('clients.brandKit.form.addFile')}
      </AddButton>
    </>
  );
}

function ReferencesField({ form }: { form: KitForm }) {
  const { t } = useTranslation();
  const { fields, append, remove, list, addButton } = useRows(form, 'references');
  const errors = form.formState.errors.references;
  return (
    <>
      {fields.length > 0 && (
        <ul ref={list} className="flex flex-col gap-3">
          {fields.map((item, index) => {
            const itemErrors = errors?.[index];
            return (
              <li
                key={item.id}
                className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_auto] sm:items-start"
              >
                <div className="grid gap-3">
                  <Controller
                    control={form.control}
                    name={`references.${index}.kind`}
                    render={({ field }) => (
                      <ToggleGroup
                        aria-label={t('clients.brandKit.form.referenceKind')}
                        value={field.value ? [field.value] : []}
                        onValueChange={(next: (typeof REFERENCE_KINDS)[number][]) => {
                          if (next[0]) field.onChange(next[0]);
                        }}
                      >
                        {REFERENCE_KINDS.map((kind) => (
                          <ToggleGroupItem key={kind} value={kind}>
                            {kind === 'liked' ? <ThumbsUpIcon /> : <ThumbsDownIcon />}
                            {t(`clients.brandKit.${kind}`)}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    )}
                  />
                  <UrlField
                    form={form}
                    name={`references.${index}.url`}
                    invalid={!!itemErrors?.url}
                  />
                  <Field invalid={!!itemErrors?.note}>
                    <FieldLabel>{t('clients.brandKit.form.referenceNote')}</FieldLabel>
                    <Input
                      placeholder={t('clients.brandKit.form.referenceNotePlaceholder')}
                      {...form.register(`references.${index}.note`)}
                    />
                    <FieldError match={!!itemErrors?.note}>
                      {t('clients.brandKit.form.errors.note')}
                    </FieldError>
                  </Field>
                </div>
                <RemoveButton
                  label={t('clients.brandKit.form.removeReference')}
                  onClick={() => remove(index)}
                />
              </li>
            );
          })}
        </ul>
      )}
      <AddButton
        ref={addButton}
        onClick={() => append({ kind: 'liked', url: '', note: '' })}
        disabled={fields.length >= LIMITS.references}
      >
        {t('clients.brandKit.form.addReference')}
      </AddButton>
    </>
  );
}

function UrlField({
  form,
  name,
  invalid,
}: {
  form: KitForm;
  name: `files.${number}.url` | `references.${number}.url`;
  invalid: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Field invalid={invalid}>
      <FieldLabel>{t('clients.brandKit.form.url')}</FieldLabel>
      <Input
        type="url"
        dir="ltr"
        placeholder={t('clients.brandKit.form.urlPlaceholder')}
        autoComplete="off"
        {...form.register(name)}
      />
      <FieldError match={invalid}>{t('clients.brandKit.form.errors.url')}</FieldError>
    </Field>
  );
}
