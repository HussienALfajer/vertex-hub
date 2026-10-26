import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { type JSONContent, mergeAttributes, Node } from '@tiptap/core';
import { ListItem } from '@tiptap/extension-list';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { EMPHASIS_MARK } from '@vertex-hub/contracts';
import {
  AtSignIcon,
  BoldIcon,
  Heading3Icon,
  HighlighterIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  UnlinkIcon,
} from 'lucide-react';
import {
  type FormEvent,
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';
import { Input } from './input';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './popover';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

/*
 * Light rich text (ADR 0038): paragraphs, level-3 headings, bold, emphasis, bullet and numbered
 * lists, and `https:` or `mailto:` links. The editor produces a TipTap document; the view renders
 * one from the same nodes, never from HTML. The app validates the document with its own schema.
 */

/** A node of a rich-text document, as the editor writes it and the view reads it. */
export type RichTextNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: readonly { type: string; attrs?: Record<string, unknown> }[];
  content?: readonly RichTextNode[];
};

export type RichTextDoc = { type: 'doc'; content?: readonly RichTextNode[] };

/** Only these link targets are written and rendered. */
export const isRichTextHref = (href: string) => /^(https:\/\/|mailto:)\S+$/i.test(href.trim());

/*
 * Shared by the editor and the view, so the preview is exact. Arabic is never slanted
 * (brand/identity.md): emphasis is a soft highlight instead.
 */
const proseClass = cn(
  'text-base leading-relaxed text-foreground [overflow-wrap:anywhere]',
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3:first-child]:mt-0',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:ps-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:ps-6',
  '[&_li]:my-1 [&_li_p]:my-0',
  '[&_strong]:font-semibold',
  '[&_em]:not-italic [&_em]:rounded-sm [&_em]:bg-status-gold [&_em]:px-0.5 [&_em]:text-status-gold-foreground',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
  '[&_[data-mention]]:rounded-sm [&_[data-mention]]:bg-status-info [&_[data-mention]]:px-1 [&_[data-mention]]:text-status-info-foreground',
);

/** A person who can be mentioned (F06B: comments, questions and replies). */
export interface MentionPerson {
  id: string;
  name: string;
}

export interface RichTextMentions {
  /** The people the picker offers. */
  people: readonly MentionPerson[];
  /** The shown name of a mentioned user, also one not offered (archived). */
  nameOf: (userId: string) => string;
  /** The toolbar button and the picker's title. */
  label: string;
  /** The picker's search field. */
  searchLabel: string;
  /** Shown when the search matches nobody. */
  empty: string;
}

/**
 * A mention node: `{ type: 'mention', attrs: { userId } }`, shown as `@Name`. An atom, so it is
 * removed whole and never edited letter by letter.
 */
const MentionNode = Node.create<{ nameOf: (userId: string) => string }>({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addOptions() {
    return { nameOf: (userId: string) => userId };
  },
  addAttributes() {
    return {
      userId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-user-id'),
        renderHTML: (attributes) => ({ 'data-user-id': attributes.userId }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-mention]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({ 'data-mention': '' }, HTMLAttributes),
      `@${this.options.nameOf(node.attrs.userId as string)}`,
    ];
  },
  renderText({ node }) {
    return `@${this.options.nameOf(node.attrs.userId as string)}`;
  },
});

export interface RichTextLabels {
  toolbar: string;
  bold: string;
  emphasis: string;
  heading: string;
  bulletList: string;
  orderedList: string;
  link: string;
  removeLink: string;
  linkUrl: string;
  linkApply: string;
  /** Shown when the address is not `https://` or `mailto:`. */
  linkInvalid: string;
}

interface RichTextEditorProps {
  id?: string;
  /** The starting document; later changes to it are not applied (remount with a `key`). */
  defaultValue?: RichTextDoc | null;
  onChange: (doc: RichTextDoc) => void;
  labels: RichTextLabels;
  /** The accessible name of the writing area (the field's label). */
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  /** Adds the mention node and its picker (F06B rule B2); without it there are no mentions. */
  mentions?: RichTextMentions;
  /**
   * Files dropped or pasted into the writing area (F06B rules B2 and C3). An empty list means the
   * clipboard held a file the browser could not read (edge case 18).
   */
  onFiles?: (files: File[], source: 'paste' | 'drop') => void;
  /** A shorter writing area, for a comment or a reply. */
  compact?: boolean;
}

/** Writes a rich-text document with a toolbar of the allowed marks and blocks. */
function RichTextEditor({
  id,
  defaultValue,
  onChange,
  labels,
  invalid,
  disabled,
  className,
  mentions,
  onFiles,
  compact,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
}: RichTextEditorProps) {
  const attributes = attributesOf({ id, labelledBy, describedBy, invalid, compact });
  // The editor is built once: its handlers read the latest props through refs.
  const filesHandler = useRef(onFiles);
  filesHandler.current = onFiles;
  const nameOf = useRef(mentions?.nameOf);
  nameOf.current = mentions?.nameOf;
  const withMentions = mentions !== undefined;
  const fileProps = useMemo(
    () => ({
      handlePaste: (_view: unknown, event: ClipboardEvent) => {
        const handler = filesHandler.current;
        const data = event.clipboardData;
        if (!handler || !data) return false;
        const files = [...data.files];
        if (files.length > 0) {
          handler(files, 'paste');
          return true;
        }
        // A copied file reference instead of the file's data (edge case 18).
        if ([...data.types].includes('Files')) {
          handler([], 'paste');
          return true;
        }
        return false;
      },
      handleDrop: (_view: unknown, event: DragEvent) => {
        const handler = filesHandler.current;
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!handler || files.length === 0) return false;
        event.preventDefault();
        handler(files, 'drop');
        return true;
      },
    }),
    [],
  );
  const editor = useEditor({
    immediatelyRender: true,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [3] },
        blockquote: false,
        code: false,
        codeBlock: false,
        hardBreak: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        listItem: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          protocols: [],
          isAllowedUri: (url) => isRichTextHref(url),
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        },
      }),
      // A list item holds paragraphs and nested lists only, never a heading.
      ListItem.extend({ content: 'paragraph (paragraph | bulletList | orderedList)*' }),
      ...(withMentions
        ? [MentionNode.configure({ nameOf: (userId) => nameOf.current?.(userId) ?? userId })]
        : []),
    ],
    content: (defaultValue as JSONContent | null | undefined) ?? undefined,
    editorProps: { attributes, ...fileProps },
    onUpdate: ({ editor: current }) => onChange(current.getJSON() as RichTextDoc),
  });

  // The writing area is the field's control: its name and error state follow the props.
  useEffect(() => {
    editor.setOptions({
      editable: !disabled,
      editorProps: {
        attributes: attributesOf({ id, labelledBy, describedBy, invalid, compact }),
        ...fileProps,
      },
    });
  }, [editor, id, labelledBy, describedBy, invalid, disabled, compact, fileProps]);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      emphasis: current.isActive(EMPHASIS_MARK),
      heading: current.isActive('heading', { level: 3 }),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      link: current.isActive('link'),
      focused: current.isFocused,
    }),
  });

  const chain = () => editor.chain().focus();

  return (
    <div
      data-slot="rich-text-editor"
      data-invalid={invalid || undefined}
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-md border border-input bg-surface transition-colors duration-150 ease-out',
        'has-[[contenteditable]:focus-visible]:outline-2 has-[[contenteditable]:focus-visible]:outline-offset-2 has-[[contenteditable]:focus-visible]:outline-ring',
        'data-invalid:border-destructive-text',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <div
        role="toolbar"
        aria-label={labels.toolbar}
        className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/60 p-1"
      >
        <ToolbarToggle
          label={labels.bold}
          pressed={state.bold}
          disabled={disabled}
          onClick={() => chain().toggleBold().run()}
        >
          <BoldIcon />
        </ToolbarToggle>
        <ToolbarToggle
          label={labels.emphasis}
          pressed={state.emphasis}
          disabled={disabled}
          onClick={() => chain().toggleItalic().run()}
        >
          <HighlighterIcon />
        </ToolbarToggle>
        <ToolbarToggle
          label={labels.heading}
          pressed={state.heading}
          disabled={disabled}
          onClick={() => chain().toggleHeading({ level: 3 }).run()}
        >
          <Heading3Icon />
        </ToolbarToggle>
        <ToolbarToggle
          label={labels.bulletList}
          pressed={state.bulletList}
          disabled={disabled}
          onClick={() => chain().toggleBulletList().run()}
        >
          <ListIcon />
        </ToolbarToggle>
        <ToolbarToggle
          label={labels.orderedList}
          pressed={state.orderedList}
          disabled={disabled}
          onClick={() => chain().toggleOrderedList().run()}
        >
          <ListOrderedIcon />
        </ToolbarToggle>
        {state.link ? (
          <ToolbarToggle
            label={labels.removeLink}
            pressed
            disabled={disabled}
            onClick={() => chain().extendMarkRange('link').unsetLink().run()}
          >
            <UnlinkIcon />
          </ToolbarToggle>
        ) : (
          <LinkPopover
            labels={labels}
            disabled={disabled}
            onApply={(href) => chain().extendMarkRange('link').setLink({ href }).run()}
          />
        )}
        {mentions && (
          <MentionPopover
            mentions={mentions}
            disabled={disabled}
            onPick={(person) =>
              chain()
                .insertContent([
                  { type: 'mention', attrs: { userId: person.id } },
                  { type: 'text', text: ' ' },
                ])
                .run()
            }
          />
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function attributesOf({
  id,
  labelledBy,
  describedBy,
  invalid,
  compact,
}: {
  id?: string;
  labelledBy?: string;
  describedBy?: string;
  invalid?: boolean;
  compact?: boolean;
}): Record<string, string> {
  return {
    ...(id && { id }),
    role: 'textbox',
    'aria-multiline': 'true',
    ...(labelledBy && { 'aria-labelledby': labelledBy }),
    ...(describedBy && { 'aria-describedby': describedBy }),
    ...(invalid && { 'aria-invalid': 'true' }),
    class: cn(proseClass, compact ? 'min-h-20' : 'min-h-40', 'px-3 py-2 outline-none'),
  };
}

function ToolbarToggle({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <TogglePrimitive
            aria-label={label}
            pressed={pressed}
            disabled={disabled}
            // The editor keeps the selection: the button never takes the focus on press.
            onMouseDown={(event) => event.preventDefault()}
            onPressedChange={onClick}
            className={toggleClass}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const toggleClass = cn(
  'inline-flex size-8 items-center justify-center rounded-sm text-muted-foreground',
  'transition-colors duration-150 ease-out hover:bg-surface hover:text-foreground',
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  'data-pressed:bg-primary data-pressed:text-primary-foreground data-pressed:hover:bg-primary-hover',
  'data-disabled:cursor-not-allowed',
);

/** Asks for the link's address; only `https://` and `mailto:` are kept. */
function LinkPopover({
  labels,
  disabled,
  onApply,
}: {
  labels: RichTextLabels;
  disabled?: boolean;
  onApply: (href: string) => void;
}) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState('');
  const [invalid, setInvalid] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    // React events bubble through the portal: the page's own form must not submit too.
    event.stopPropagation();
    if (!isRichTextHref(href)) {
      setInvalid(true);
      return;
    }
    setOpen(false);
    onApply(href.trim());
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setHref('');
          setInvalid(false);
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              aria-label={labels.link}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              className={toggleClass}
            />
          }
        >
          <LinkIcon />
        </TooltipTrigger>
        <TooltipContent>{labels.link}</TooltipContent>
      </Tooltip>
      <PopoverContent className="gap-3 p-4" align="start">
        <PopoverTitle>{labels.link}</PopoverTitle>
        {/* A form of its own inside the portal, so Enter never submits the page's form. */}
        <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
          <label htmlFor={inputId} className="sr-only">
            {labels.linkUrl}
          </label>
          <Input
            id={inputId}
            dir="ltr"
            type="url"
            autoFocus
            placeholder="https://"
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${inputId}-error` : undefined}
            value={href}
            onChange={(event) => {
              setHref(event.target.value);
              setInvalid(false);
            }}
          />
          {invalid && (
            <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive-text">
              {labels.linkInvalid}
            </p>
          )}
          <Button type="submit" size="sm" className="self-end">
            {labels.linkApply}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Picks a person to mention at the caret, from a searchable list. */
function MentionPopover({
  mentions,
  disabled,
  onPick,
}: {
  mentions: RichTextMentions;
  disabled?: boolean;
  onPick: (person: MentionPerson) => void;
}) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const matches = mentions.people.filter((person) =>
    person.name.toLocaleLowerCase().includes(query),
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSearch('');
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              aria-label={mentions.label}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              className={toggleClass}
            />
          }
        >
          <AtSignIcon />
        </TooltipTrigger>
        <TooltipContent>{mentions.label}</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-72 gap-3 p-3" align="start">
        <PopoverTitle>{mentions.label}</PopoverTitle>
        <label htmlFor={inputId} className="sr-only">
          {mentions.searchLabel}
        </label>
        <Input
          id={inputId}
          autoFocus
          placeholder={mentions.searchLabel}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            // Enter picks the first match and never submits the page's form.
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const first = matches[0];
            if (first) {
              setOpen(false);
              onPick(first);
            }
          }}
        />
        {matches.length === 0 ? (
          <p className="text-sm text-muted-foreground">{mentions.empty}</p>
        ) : (
          <ul className="flex max-h-60 flex-col overflow-y-auto">
            {matches.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  className="w-full rounded-sm px-2 py-1.5 text-start text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => {
                    setOpen(false);
                    onPick(person);
                  }}
                >
                  {person.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Renders a rich-text document from its nodes; unknown nodes and marks are skipped. A mention is
 * rendered by `renderMention` (the app knows the person); without it, mentions are skipped.
 */
function RichTextView({
  doc,
  className,
  renderMention,
}: {
  doc: RichTextDoc;
  className?: string;
  renderMention?: (userId: string) => ReactNode;
}) {
  return (
    <div data-slot="rich-text" className={cn(proseClass, className)}>
      {renderNodes(doc.content ?? [], renderMention)}
    </div>
  );
}

type MentionRenderer = ((userId: string) => ReactNode) | undefined;

function renderNodes(nodes: readonly RichTextNode[], mention: MentionRenderer): ReactNode {
  return nodes.map((node, index) => (
    // The document is rendered whole each time: positions are stable keys.
    // biome-ignore lint/suspicious/noArrayIndexKey: see above
    <Fragment key={index}>{renderNode(node, mention)}</Fragment>
  ));
}

function renderNode(node: RichTextNode, mention: MentionRenderer): ReactNode {
  const children = renderNodes(node.content ?? [], mention);
  switch (node.type) {
    case 'paragraph':
      return <p>{children}</p>;
    case 'heading':
      return <h3>{children}</h3>;
    case 'bulletList':
      return <ul>{children}</ul>;
    case 'orderedList': {
      const start = node.attrs?.start;
      return <ol start={typeof start === 'number' ? start : undefined}>{children}</ol>;
    }
    case 'listItem':
      return <li>{children}</li>;
    case 'text':
      return renderText(node);
    case 'mention': {
      const userId = node.attrs?.userId;
      return typeof userId === 'string' && mention ? mention(userId) : null;
    }
    default:
      return null;
  }
}

function renderText(node: RichTextNode): ReactNode {
  let out: ReactNode = node.text ?? '';
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') out = <strong>{out}</strong>;
    else if (mark.type === EMPHASIS_MARK) out = <em>{out}</em>;
    else if (mark.type === 'link') {
      const href = mark.attrs?.href;
      if (typeof href === 'string' && isRichTextHref(href)) {
        out = (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {out}
          </a>
        );
      }
    }
  }
  return out;
}

export { RichTextEditor, RichTextView };
