import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { CheckIcon, PlusIcon, XIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '../lib/cn';
import { popupMotion } from '../lib/motion';

interface MultiComboboxProps<Item> {
  id?: string;
  items: readonly Item[];
  value: readonly Item[];
  onValueChange: (value: Item[]) => void;
  itemToLabel: (item: Item) => string;
  itemToKey: (item: Item) => string;
  placeholder?: string;
  /** Shown when nothing matches the typed text. */
  emptyLabel: string;
  /** Accessible name of a chip's remove button, e.g. "Remove Design". */
  removeLabel: (label: string) => string;
  /** Lets the user add the typed text as a new item, offered as "Add “text”". */
  create?: { label: (text: string) => string; toItem: (text: string) => Item };
  /** Called with the typed text, for items searched on the server; `items` then holds matches. */
  onSearch?: (text: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Picks several items, shown as removable chips, with type-ahead filtering. The first match is
 * highlighted, so Enter picks it (or adds the typed text); Enter with typed text never submits
 * the surrounding form. Backspace removes the last chip; arrow keys move between chips and the
 * list.
 */
function MultiCombobox<Item>({
  id,
  items,
  value,
  onValueChange,
  itemToLabel,
  itemToKey,
  placeholder,
  emptyLabel,
  removeLabel,
  create,
  onSearch,
  invalid,
  disabled,
  className,
}: MultiComboboxProps<Item>) {
  const [input, setInput] = useState('');
  const text = input.trim();

  const known = useMemo(() => {
    const byKey = new Map<string, Item>();
    for (const item of [...items, ...value]) byKey.set(itemToKey(item), item);
    return [...byKey.values()];
  }, [items, value, itemToKey]);

  const draft =
    create &&
    text &&
    !known.some((item) => itemToLabel(item).toLocaleLowerCase() === text.toLocaleLowerCase())
      ? create.toItem(text)
      : null;
  const draftKey = draft ? itemToKey(draft) : null;
  const options = draft ? [...known, draft] : known;

  return (
    <ComboboxPrimitive.Root
      items={options}
      multiple
      value={value as Item[]}
      onValueChange={(next) => {
        onValueChange(next as Item[]);
        setInput('');
        onSearch?.('');
      }}
      inputValue={input}
      onInputValueChange={(next) => {
        setInput(next);
        onSearch?.(next.trim());
      }}
      autoHighlight
      itemToStringLabel={itemToLabel}
      itemToStringValue={itemToKey}
      isItemEqualToValue={(a, b) => itemToKey(a) === itemToKey(b)}
      disabled={disabled}
    >
      <ComboboxPrimitive.InputGroup
        data-slot="multi-combobox"
        aria-invalid={invalid || undefined}
        className={cn(
          'flex min-h-9 w-full cursor-text items-center rounded-md border border-input bg-surface px-1 py-1',
          'transition-colors duration-150 ease-out aria-invalid:border-destructive-text',
          // The focus ring every control has (brand §2), drawn around the whole group.
          'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring',
          'data-disabled:cursor-not-allowed data-disabled:opacity-50',
          className,
        )}
      >
        <ComboboxPrimitive.Chips className="flex w-full flex-wrap items-center gap-1">
          {value.map((item) => (
            <ComboboxPrimitive.Chip
              key={itemToKey(item)}
              className={cn(
                'flex h-7 max-w-full cursor-default items-center gap-1 rounded-sm bg-muted ps-2 pe-1 text-sm text-foreground outline-none',
                'focus-within:bg-secondary-hover data-highlighted:bg-secondary-hover',
              )}
            >
              <span className="truncate">{itemToLabel(item)}</span>
              <ComboboxPrimitive.ChipRemove
                aria-label={removeLabel(itemToLabel(item))}
                className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 hover:bg-border hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </ComboboxPrimitive.ChipRemove>
            </ComboboxPrimitive.Chip>
          ))}
          <ComboboxPrimitive.Input
            id={id}
            placeholder={value.length > 0 ? undefined : placeholder}
            onKeyDown={(event) => {
              // Typed text with nothing to pick must not submit the form and lose the text.
              if (event.key === 'Enter' && text) event.preventDefault();
            }}
            className="h-7 min-w-24 flex-1 bg-transparent px-2 text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
        </ComboboxPrimitive.Chips>
      </ComboboxPrimitive.InputGroup>

      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner sideOffset={4} className="z-50 outline-none">
          <ComboboxPrimitive.Popup
            data-slot="multi-combobox-content"
            className={cn(
              'max-h-[min(var(--available-height),18rem)] w-(--anchor-width) max-w-(--available-width) overflow-y-auto rounded-lg border border-border bg-surface p-1 text-surface-foreground shadow-float outline-none',
              popupMotion,
            )}
          >
            <ComboboxPrimitive.Empty className="px-2 py-1.5 text-sm text-muted-foreground empty:hidden">
              {emptyLabel}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List>
              {(item: Item) => {
                const key = itemToKey(item);
                return (
                  <ComboboxPrimitive.Item
                    key={key}
                    value={item}
                    className={cn(
                      'relative flex cursor-default items-center gap-2 rounded-sm py-1.5 ps-2 pe-8 text-base outline-none select-none',
                      'data-highlighted:bg-muted',
                    )}
                  >
                    {key === draftKey && create ? (
                      <>
                        <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
                        {create.label(text)}
                      </>
                    ) : (
                      itemToLabel(item)
                    )}
                    <ComboboxPrimitive.ItemIndicator className="absolute end-2 flex text-foreground">
                      <CheckIcon className="size-4" />
                    </ComboboxPrimitive.ItemIndicator>
                  </ComboboxPrimitive.Item>
                );
              }}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}

export { MultiCombobox, type MultiComboboxProps };
