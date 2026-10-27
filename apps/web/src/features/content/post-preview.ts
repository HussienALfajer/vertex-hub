import type { PostPlatform, PostType } from '@vertex-hub/contracts';

/*
 * F08B screens 1, 4 and 8: what a platform shows of a caption before "more". The platforms cut a
 * feed caption after a few lines or characters; the values are close to what they show on a phone
 * in 2026-10, not exact, and only shape the preview.
 */

interface PreviewCut {
  /** Characters shown before "more", in code points. */
  characters: number;
  /** Lines shown before "more". */
  lines: number;
}

/** Null: the platform shows the whole text. */
export const PREVIEW_CUTS: Record<PostPlatform, PreviewCut | null> = {
  instagram: { characters: 125, lines: 2 },
  facebook: { characters: 480, lines: 5 },
  tiktok: { characters: 100, lines: 2 },
  x: null,
  linkedin: { characters: 210, lines: 3 },
  youtube: { characters: 100, lines: 3 },
  snapchat: null,
  google_business: { characters: 250, lines: 4 },
};

/** The text as the platform shows it folded, and whether it was cut. */
export function previewCaption(
  text: string,
  platform: PostPlatform,
): { shown: string; cut: boolean } {
  const rule = PREVIEW_CUTS[platform];
  if (!rule) return { shown: text, cut: false };
  const lines = text.split('\n');
  let shown = lines.slice(0, rule.lines).join('\n');
  let cut = lines.length > rule.lines;
  const points = [...shown];
  if (points.length > rule.characters) {
    shown = points.slice(0, rule.characters).join('').trimEnd();
    cut = true;
  }
  return { shown, cut };
}

/** The frame of the media: a story, a reel or a Short stands; a YouTube video lies down. */
export function previewRatio(
  platform: PostPlatform,
  type: PostType,
): 'portrait' | 'square' | 'wide' {
  if (type === 'reel' || type === 'story' || platform === 'snapchat') return 'portrait';
  if (platform === 'youtube') return 'wide';
  return platform === 'instagram' ? 'square' : 'wide';
}
