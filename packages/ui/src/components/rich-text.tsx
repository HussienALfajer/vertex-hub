import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import type { JSONContent } from '@tiptap/core';
import { ListItem } from '@tiptap/extension-list';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { EMPHASIS_MARK } from '@vertex-hub/contracts';
import {
  BoldIcon,
  Heading3Icon,
  HighlighterIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  UnlinkIcon,
} from 'lucide-react';
import { type FormEvent, Fragment, type ReactNode, useEffect, useId, useState } from 'react';
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
);

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
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
}: RichTextEditorProps) {
  const attributes = attributesOf({ id, labelledBy, describedBy, invalid });
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
    ],
    content: (defaultValue as JSONContent | null | undefined) ?? undefined,
    editorProps: { attributes },
    onUpdate: ({ editor: current }) => onChange(current.getJSON() as RichTextDoc),
  });

  // The writing area is the field's control: its name and error state follow the props.
  useEffect(() => {
    editor.setOptions({
      editable: !disabled,
      editorProps: { attributes: attributesOf({ id, labelledBy, describedBy, invalid }) },
    });
  }, [editor, id, labelledBy, describedBy, invalid, disabled]);

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
}: {
  id?: string;
  labelledBy?: string;
  describedBy?: string;
  invalid?: boolean;
}): Record<string, string> {
  return {
    ...(id && { id }),
    role: 'textbox',
    'aria-multiline': 'true',
    ...(labelledBy && { 'aria-labelledby': labelledBy }),
    ...(describedBy && { 'aria-describedby': describedBy }),
    ...(invalid && { 'aria-invalid': 'true' }),
    class: cn(proseClass, 'min-h-40 px-3 py-2 outline-none'),
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

/** Renders a rich-text document from its nodes; unknown nodes and marks are skipped. */
function RichTextView({ doc, className }: { doc: RichTextDoc; className?: string }) {
  return (
    <div data-slot="rich-text" className={cn(proseClass, className)}>
      {renderNodes(doc.content ?? [])}
    </div>
  );
}

function renderNodes(nodes: readonly RichTextNode[]): ReactNode {
  return nodes.map((node, index) => (
    // The document is rendered whole each time: positions are stable keys.
    // biome-ignore lint/suspicious/noArrayIndexKey: see above
    <Fragment key={index}>{renderNode(node)}</Fragment>
  ));
}

function renderNode(node: RichTextNode): ReactNode {
  const children = renderNodes(node.content ?? []);
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
