import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const avatarVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center overflow-hidden font-medium leading-none select-none',
  {
    variants: {
      size: {
        sm: 'size-7 text-xs',
        md: 'size-9 text-sm',
        lg: 'size-14 text-lg',
        xl: 'size-20 text-2xl',
      },
      /** People are round; organizations, such as clients, are square (§4). */
      shape: {
        circle: 'rounded-full',
        square: 'rounded-lg font-bold',
      },
      tone: {
        brand: 'bg-primary text-primary-foreground',
        muted: 'bg-muted text-muted-foreground',
        accent: 'bg-accent text-accent-foreground',
      },
    },
    defaultVariants: { size: 'md', shape: 'circle', tone: 'brand' },
  },
);

/** Arabic definite article, skipped when taking a word's initial. */
const ARTICLE = 'ال';

/** Arabic letters side by side join into a word; a thin space keeps initials apart. */
const THIN_SPACE = ' ';
const ARABIC = /[؀-ۿ]/;

/**
 * The first letter of the first two words; a leading Arabic article is skipped, so a family name
 * such as "الخطيب" gives its first real letter.
 */
function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) =>
      word.startsWith(ARTICLE) && word.length > ARTICLE.length
        ? word.charAt(ARTICLE.length)
        : word.charAt(0),
    )
    .join(ARABIC.test(name) ? THIN_SPACE : '');
}

type AvatarProps = Omit<AvatarPrimitive.Root.Props, 'children' | 'className'> &
  VariantProps<typeof avatarVariants> & {
    /** The person's name: the source of the initials. */
    name: string;
    /** The picture's URL; the initials show while it loads, without it and when it fails. */
    src?: string | null;
    className?: string;
  };

/**
 * A person's or organization's picture, or their initials when there is none (F01C). A loaded
 * picture sits on a white surface in both themes, so a transparent logo reads on it. Decorative:
 * show the name nearby.
 */
function Avatar({ name, src, size, shape, tone, className, ...props }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      aria-hidden="true"
      className={(state) =>
        cn(
          avatarVariants({ size, shape, tone }),
          // A hairline keeps a white logo apart from a white card.
          state.imageLoadingStatus === 'loaded' && 'bg-avatar-image ring-1 ring-border',
          className,
        )
      }
      {...props}
    >
      {src && <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" />}
      <AvatarPrimitive.Fallback>{initialsOf(name)}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export { Avatar, type AvatarProps, avatarVariants, initialsOf };
