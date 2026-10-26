import { describe, expect, it } from 'vitest';
import {
  type CheckedCaption,
  type CheckedMedium,
  groupTextLimit,
  hashtagCount,
  type PostCheckCode,
  postChecks,
  textLength,
} from './post-checks.js';
import {
  captionGroupOf,
  captionGroupsOf,
  type PostPlatform,
  type PostType,
} from './post-values.js';

const NOT_LONG = { xLongPosts: false };

const caption = (fields: Partial<CheckedCaption> = {}): CheckedCaption => ({
  group: 'facebook_instagram',
  caption: 'Caption',
  hashtags: null,
  title: null,
  ...fields,
});

const image = (width: number, height: number): CheckedMedium => ({
  type: 'image',
  width,
  height,
  durationMs: null,
});

const video = (seconds: number | null, width = 1080, height = 1920): CheckedMedium => ({
  type: 'video',
  width,
  height,
  durationMs: seconds === null ? null : seconds * 1000,
});

const codes = (checks: { code: PostCheckCode }[]) => checks.map((check) => check.code);

describe('caption groups', () => {
  it('put Facebook with Instagram and every other platform alone', () => {
    expect(captionGroupOf('facebook')).toBe('facebook_instagram');
    expect(captionGroupOf('instagram')).toBe('facebook_instagram');
    expect(captionGroupOf('tiktok')).toBe('tiktok');
    expect(captionGroupsOf(['x', 'instagram', 'facebook', 'youtube'])).toEqual([
      'x',
      'facebook_instagram',
      'youtube',
    ]);
  });
});

describe('text limits', () => {
  it('count code points and hashtags', () => {
    expect(textLength('سلام 👋')).toBe(6);
    expect(textLength(null)).toBe(0);
    expect(hashtagCount('#one #two text #ثلاثة ## #')).toBe(3);
  });

  it('take the lowest limit of the group, and X long posts from the settings', () => {
    const both: PostPlatform[] = ['facebook', 'instagram'];
    expect(groupTextLimit(['facebook'], 'facebook_instagram', NOT_LONG)).toEqual({
      platform: 'facebook',
      limit: 5000,
    });
    expect(groupTextLimit(both, 'facebook_instagram', NOT_LONG)).toEqual({
      platform: 'instagram',
      limit: 2200,
    });
    expect(groupTextLimit(['x'], 'x', NOT_LONG)?.limit).toBe(280);
    expect(groupTextLimit(['x'], 'x', { xLongPosts: true })?.limit).toBe(5000);
    expect(groupTextLimit(['x'], 'tiktok', NOT_LONG)).toBeNull();
  });
});

describe('postChecks', () => {
  const post = (
    platforms: PostPlatform[],
    captions: CheckedCaption[],
    type: PostType = 'post',
  ) => ({
    type,
    platforms,
    captions,
  });

  it('passes a post within every limit', () => {
    expect(postChecks(post(['instagram'], [caption()]), [image(1080, 1350)], NOT_LONG)).toEqual([]);
  });

  it('blocks a caption over its group limit, counting the hashtags after a blank line', () => {
    // 270 + 2 + 9 = 281 > 280.
    const x = caption({ group: 'x', caption: 'x'.repeat(270), hashtags: '#hashtags' });
    const [check] = postChecks(post(['x'], [x]), [], NOT_LONG);
    expect(check).toEqual({
      code: 'caption_too_long',
      group: 'x',
      platform: 'x',
      limit: 280,
      actual: 281,
      blocking: true,
    });
    expect(postChecks(post(['x'], [x]), [], { xLongPosts: true })).toEqual([]);
  });

  it('applies Instagram limits when Instagram joins Facebook (edge case 3)', () => {
    const long = caption({ caption: 'x'.repeat(3000) });
    expect(postChecks(post(['facebook'], [long]), [], NOT_LONG)).toEqual([]);
    expect(codes(postChecks(post(['facebook', 'instagram'], [long]), [], NOT_LONG))).toEqual([
      'caption_too_long',
    ]);
  });

  it('blocks more than 30 Instagram hashtags, and not on Facebook alone', () => {
    const tags = Array.from({ length: 31 }, (_, n) => `#t${n}`).join(' ');
    const tagged = caption({ hashtags: tags });
    expect(postChecks(post(['instagram'], [tagged]), [], NOT_LONG)).toContainEqual(
      expect.objectContaining({ code: 'too_many_hashtags', limit: 30, actual: 31, blocking: true }),
    );
    expect(postChecks(post(['facebook'], [tagged]), [], NOT_LONG)).toEqual([]);
  });

  it('blocks a long YouTube title and warns on a missing one', () => {
    const youtube = (title: string | null) => caption({ group: 'youtube', title });
    expect(codes(postChecks(post(['youtube'], [youtube('t'.repeat(101))]), [], NOT_LONG))).toEqual([
      'title_too_long',
    ]);
    const missing = postChecks(post(['youtube'], [youtube(null)]), [], NOT_LONG);
    expect(missing).toEqual([
      { code: 'title_missing', group: 'youtube', platform: 'youtube', blocking: false },
    ]);
  });

  it('warns on an empty caption of a group, except on stories', () => {
    const checks = postChecks(post(['instagram', 'tiktok'], [caption()]), [], NOT_LONG);
    expect(checks).toEqual([{ code: 'caption_empty', group: 'tiktok', blocking: false }]);
    expect(postChecks(post(['tiktok'], [], 'story'), [video(10)], NOT_LONG)).toEqual([]);
  });

  it('ignores captions of groups outside the platforms', () => {
    const other = caption({ group: 'x', caption: 'x'.repeat(400) });
    expect(postChecks(post(['instagram'], [caption(), other]), [], NOT_LONG)).toEqual([]);
  });

  it('warns on a reel without a video and a video longer than a platform takes', () => {
    const reel = (media: CheckedMedium[]) =>
      postChecks(
        { type: 'reel', platforms: ['instagram', 'facebook'], captions: [caption()] },
        media,
        NOT_LONG,
      );
    expect(codes(reel([image(1080, 1920)]))).toEqual(['video_missing']);
    expect(reel([video(120)])).toEqual([
      {
        code: 'video_too_long',
        platform: 'facebook',
        mediaIndex: 0,
        limit: 90,
        actual: 120,
        blocking: false,
      },
    ]);
    // Unmeasured media are not checked (edge case 16).
    expect(reel([video(null, 0, 0)])).toEqual([]);
  });

  it('warns on a ratio outside the recommended ones, within 2%', () => {
    const feed = (media: CheckedMedium[]) =>
      postChecks(post(['instagram'], [caption()]), media, NOT_LONG);
    expect(feed([image(1080, 1080), image(1080, 1350), image(1080, 566)])).toEqual([]);
    expect(feed([image(1080, 1100)])).toEqual([]);
    expect(feed([image(1080, 1920)])).toEqual([
      { code: 'aspect_ratio', platform: 'instagram', mediaIndex: 0, blocking: false },
    ]);
  });

  it('warns on more slides than a platform takes and on mixed ratios in a carousel', () => {
    const slides = Array.from({ length: 5 }, () => image(1080, 1080));
    expect(postChecks(post(['x'], [caption({ group: 'x' })]), slides, NOT_LONG)).toEqual([
      { code: 'too_many_slides', platform: 'x', limit: 4, actual: 5, blocking: false },
    ]);
    const carousel = postChecks(
      { type: 'carousel', platforms: ['facebook'], captions: [caption()] },
      [image(1080, 1080), image(1080, 1350)],
      NOT_LONG,
    );
    expect(codes(carousel)).toEqual(['mixed_ratios']);
  });

  it('warns past 40 media (edge case 15)', () => {
    const many = Array.from({ length: 41 }, () => image(1080, 1080));
    expect(
      codes(postChecks(post(['linkedin'], [caption({ group: 'linkedin' })]), many, NOT_LONG)),
    ).toEqual(['too_many_slides', 'too_many_media']);
  });
});
