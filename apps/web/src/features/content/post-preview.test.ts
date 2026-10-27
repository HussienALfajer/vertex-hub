import { describe, expect, it } from 'vitest';
import { previewCaption, previewRatio } from './post-preview';

describe('previewCaption', () => {
  it('shows a short caption whole', () => {
    expect(previewCaption('قهوة الصباح', 'instagram')).toEqual({
      shown: 'قهوة الصباح',
      cut: false,
    });
  });

  it('cuts after the lines the platform shows', () => {
    expect(previewCaption('سطر 1\nسطر 2\nسطر 3', 'instagram')).toEqual({
      shown: 'سطر 1\nسطر 2',
      cut: true,
    });
  });

  it('cuts after the characters, counted in code points', () => {
    const text = '😀'.repeat(130);
    const { shown, cut } = previewCaption(text, 'instagram');
    expect([...shown]).toHaveLength(125);
    expect(cut).toBe(true);
  });

  it('never cuts where the platform shows everything', () => {
    const text = 'أ'.repeat(270);
    expect(previewCaption(text, 'x')).toEqual({ shown: text, cut: false });
  });
});

describe('previewRatio', () => {
  it('stands for reels and stories, lies down for a YouTube video', () => {
    expect(previewRatio('instagram', 'reel')).toBe('portrait');
    expect(previewRatio('facebook', 'story')).toBe('portrait');
    expect(previewRatio('youtube', 'post')).toBe('wide');
    expect(previewRatio('instagram', 'carousel')).toBe('square');
  });
});
