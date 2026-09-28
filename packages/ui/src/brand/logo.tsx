import type { ComponentProps } from 'react';
import logoSource from '../../../../brand/logo/svg/vertex-logo.svg?raw';
import markSource from '../../../../brand/logo/svg/vertex-mark.svg?raw';
import { cn } from '../lib/cn';

/*
 * The logo components render the `currentColor` SVGs from brand/logo/svg, the single home of the
 * logo files: the path data is read from those files at build time, never copied.
 */

interface SvgShape {
  viewBox: string;
  d: string;
}

function parseSvg(source: string): SvgShape {
  const viewBox = /viewBox="([^"]+)"/.exec(source)?.[1];
  const d = /<path[^>]*\sd="([^"]+)"/.exec(source)?.[1];
  if (!viewBox || !d) throw new Error('Unexpected logo SVG structure');
  return { viewBox, d };
}

const logo = parseSvg(logoSource);
const mark = parseSvg(markSource);

type LogoProps = Omit<ComponentProps<'svg'>, 'viewBox' | 'children'> & {
  /** Accessible name. Omit only when the logo is decorative (a visible name sits next to it). */
  label?: string;
};

function BrandSvg({ shape, label, className, ...props }: LogoProps & { shape: SvgShape }) {
  const path = <path fill="currentColor" fillRule="evenodd" d={shape.d} />;
  const svgProps = {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: shape.viewBox,
    className: cn('shrink-0', className),
    ...props,
  };
  if (!label) {
    return (
      <svg aria-hidden="true" {...svgProps}>
        {path}
      </svg>
    );
  }
  return (
    <svg role="img" aria-label={label} {...svgProps}>
      <title>{label}</title>
      {path}
    </svg>
  );
}

/**
 * Full logo (mark and wordmark), in the current text color. Minimum width 96 px (§7).
 * Approved colorways: green on light surfaces, sand or white on Vertex Green.
 */
function VertexLogo({ className, ...props }: LogoProps) {
  return <BrandSvg shape={logo} className={cn('w-24', className)} {...props} />;
}

/** The mark alone, in the current text color. Minimum width 24 px (§7). */
function VertexMark({ className, ...props }: LogoProps) {
  return <BrandSvg shape={mark} className={cn('w-6', className)} {...props} />;
}

export { VertexLogo, VertexMark };
