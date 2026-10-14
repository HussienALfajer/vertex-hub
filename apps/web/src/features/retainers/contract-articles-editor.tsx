import {
  CONTRACT_BLOCK_PLACEHOLDERS,
  CONTRACT_LIMITS,
  CONTRACT_VALUE_PLACEHOLDERS,
  type ContractPlaceholder,
} from '@vertex-hub/contracts';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
  Textarea,
} from '@vertex-hub/ui';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BracesIcon,
  FileTextIcon,
  GripVerticalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { type DragEvent, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { type Control, type UseFormReturn, useFieldArray } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { focusAfterRemoval } from '../../lib/focus-after-removal';
import { formatNumber } from '../../lib/format';

/** An article as the editor holds it: `id` for a stored one, none for a new one. */
export interface ArticleValues {
  id?: string;
  title: string;
  body: string;
}

export interface ArticlesFormValues {
  articles: ArticleValues[];
}

/**
 * The ordered list of contract articles (K12, later each contract's own copy, K2): edit the title
 * and body, insert placeholders and blocks at the cursor, add, remove and move with up/down.
 * Articles are numbered by position, as the contract prints them.
 */
export function ContractArticlesEditor({
  form,
  readOnly,
  /** Article positions whose body names an unknown placeholder, flagged by the page. */
  unknown,
}: {
  form: UseFormReturn<ArticlesFormValues>;
  readOnly: boolean;
  unknown: ReadonlySet<number>;
}) {
  const { t } = useTranslation();
  const errorId = useId();
  const { fields, append, remove, move } = useFieldArray({
    control: form.control as Control<ArticlesFormValues>,
    name: 'articles',
  });
  const list = useRef<HTMLOListElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const bodies = useRef(new Map<string, HTMLTextAreaElement>());
  const full = fields.length >= CONTRACT_LIMITS.articles;
  // Drag starts from a row's grip only, so selecting text in its fields never moves it; the
  // up/down buttons are the keyboard way.
  const [armed, setArmed] = useState<string | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const draggable = !readOnly && fields.length > 1;

  const dragProps = (rowId: string, index: number) =>
    draggable
      ? {
          draggable: armed === rowId,
          onDragStart: (event: DragEvent) => {
            event.dataTransfer.effectAllowed = 'move';
            setDragged(index);
          },
          onDragOver: (event: DragEvent) => {
            if (dragged === null) return;
            event.preventDefault();
            setTarget(index);
          },
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            if (dragged !== null && dragged !== index) move(dragged, index);
            endDrag();
          },
          onDragEnd: endDrag,
        }
      : {};

  function endDrag() {
    setArmed(null);
    setDragged(null);
    setTarget(null);
  }

  function removeRow(index: number) {
    flushSync(() => remove(index));
    focusAfterRemoval(list.current, index, addButton.current);
  }

  /** Keeps the focus on the button that moved the row, or the other direction's at an end. */
  function moveRow(from: number, to: number) {
    flushSync(() => move(from, to));
    const row = list.current?.children[to];
    const [same, other] = to < from ? ['up', 'down'] : ['down', 'up'];
    const button = (name: string) =>
      row?.querySelector<HTMLButtonElement>(`[data-focus="${name}"]`);
    const target = button(same);
    (target && !target.disabled ? target : button(other))?.focus();
  }

  function addRow() {
    flushSync(() => append({ title: '', body: '' }, { shouldFocus: true }));
  }

  /** Inserts at the cursor; a block stands on a line of its own (K7). */
  function insert(index: number, rowId: string, placeholder: ContractPlaceholder) {
    const name = `articles.${index}.body` as const;
    const text = form.getValues(name) ?? '';
    const area = bodies.current.get(rowId);
    const start = area?.selectionStart ?? text.length;
    const end = area?.selectionEnd ?? text.length;
    const token = `{${placeholder}}`;
    const block = (CONTRACT_BLOCK_PLACEHOLDERS as readonly string[]).includes(placeholder);
    const before = text.slice(0, start);
    const after = text.slice(end);
    const inserted = block
      ? `${before && !before.endsWith('\n') ? '\n' : ''}${token}${after && !after.startsWith('\n') ? '\n' : ''}`
      : token;
    form.setValue(name, `${before}${inserted}${after}`, { shouldDirty: true });
    requestAnimationFrame(() => {
      const caret = before.length + inserted.length;
      area?.focus();
      area?.setSelectionRange(caret, caret);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {fields.length === 0 ? (
        <EmptyState
          icon={<FileTextIcon />}
          title={t('retainers.contractSettings.articles.emptyTitle')}
          description={t('retainers.contractSettings.articles.emptyHint')}
        />
      ) : (
        <ol ref={list} className="flex flex-col gap-4">
          {fields.map((row, index) => {
            const errors = form.formState.errors.articles?.[index];
            const position = formatNumber(index + 1);
            const last = index === fields.length - 1;
            const bodyInvalid = !!errors?.body || unknown.has(index);
            const bodyField = form.register(`articles.${index}.body`);
            return (
              <li
                key={row.id}
                className={cn(
                  'flex flex-col gap-3 rounded-lg border border-border bg-surface p-4',
                  target === index && dragged !== index && 'border-primary bg-muted/50',
                  dragged === index && 'opacity-50',
                )}
                {...dragProps(row.id, index)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {draggable && (
                    <GripVerticalIcon
                      aria-hidden="true"
                      data-testid="article-grip"
                      className="size-4 shrink-0 cursor-grab text-muted-foreground"
                      onPointerDown={() => setArmed(row.id)}
                      onPointerUp={() => dragged === null && setArmed(null)}
                    />
                  )}
                  <span className="shrink-0 text-sm font-bold text-muted-foreground">
                    {t('retainers.contractSettings.articles.number', { position })}
                  </span>
                  <Input
                    aria-label={t('retainers.contractSettings.articles.titleLabel', { position })}
                    aria-invalid={!!errors?.title || undefined}
                    aria-describedby={errors?.title ? `${errorId}-title-${index}` : undefined}
                    placeholder={t('retainers.contractSettings.articles.titlePlaceholder')}
                    readOnly={readOnly}
                    className="basis-full font-medium sm:basis-0 sm:flex-1"
                    {...form.register(`articles.${index}.title`)}
                  />
                  {!readOnly && (
                    <div className="ms-auto flex">
                      <IconButton
                        data-focus="up"
                        disabled={index === 0}
                        label={t('retainers.contractSettings.articles.moveUp', { position })}
                        onClick={() => moveRow(index, index - 1)}
                      >
                        <ArrowUpIcon />
                      </IconButton>
                      <IconButton
                        data-focus="down"
                        disabled={last}
                        label={t('retainers.contractSettings.articles.moveDown', { position })}
                        onClick={() => moveRow(index, index + 1)}
                      >
                        <ArrowDownIcon />
                      </IconButton>
                      <IconButton
                        data-focus="remove"
                        label={t('retainers.contractSettings.articles.remove', { position })}
                        onClick={() => removeRow(index)}
                      >
                        <Trash2Icon />
                      </IconButton>
                    </div>
                  )}
                </div>
                {errors?.title && (
                  <p id={`${errorId}-title-${index}`} className="text-sm text-destructive-text">
                    {t('retainers.contractSettings.articles.errors.title')}
                  </p>
                )}
                <Textarea
                  aria-label={t('retainers.contractSettings.articles.bodyLabel', { position })}
                  aria-invalid={bodyInvalid || undefined}
                  aria-describedby={bodyInvalid ? `${errorId}-body-${index}` : undefined}
                  rows={5}
                  readOnly={readOnly}
                  {...bodyField}
                  ref={(element) => {
                    bodyField.ref(element);
                    if (element) bodies.current.set(row.id, element);
                    else bodies.current.delete(row.id);
                  }}
                />
                {bodyInvalid && (
                  <p id={`${errorId}-body-${index}`} className="text-sm text-destructive-text">
                    {unknown.has(index)
                      ? t('errors.UNKNOWN_PLACEHOLDER')
                      : t('retainers.contractSettings.articles.errors.body')}
                  </p>
                )}
                {!readOnly && (
                  <div>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                        <BracesIcon />
                        {t('retainers.contractSettings.articles.insert')}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuGroup>
                          <DropdownMenuLabel>
                            {t('retainers.contractSettings.articles.values')}
                          </DropdownMenuLabel>
                          {CONTRACT_VALUE_PLACEHOLDERS.map((name) => (
                            <DropdownMenuItem
                              key={name}
                              onClick={() => insert(index, row.id, name)}
                            >
                              {t(`retainers.contractSettings.placeholders.${name}`)}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuGroup>
                        <DropdownMenuGroup>
                          <DropdownMenuLabel>
                            {t('retainers.contractSettings.articles.blocks')}
                          </DropdownMenuLabel>
                          {CONTRACT_BLOCK_PLACEHOLDERS.map((name) => (
                            <DropdownMenuItem
                              key={name}
                              onClick={() => insert(index, row.id, name)}
                            >
                              {t(`retainers.contractSettings.placeholders.${name}`)}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <Button ref={addButton} variant="outline" disabled={full} onClick={addRow}>
            <PlusIcon />
            {t('retainers.contractSettings.articles.add')}
          </Button>
          <p className="text-sm text-muted-foreground">
            {full
              ? t('retainers.contractSettings.articles.full', {
                  limit: formatNumber(CONTRACT_LIMITS.articles),
                })
              : t('retainers.contractSettings.articles.usage', {
                  shown: formatNumber(fields.length),
                  limit: formatNumber(CONTRACT_LIMITS.articles),
                })}
          </p>
        </div>
      )}
    </div>
  );
}
