import { describe, expect, it } from 'vitest';
import { CLIENT_PLATFORMS } from './clients.js';
import {
  allowedPostTransitions,
  canMakePostMove,
  contentCalendarQuerySchema,
  createPostSchema,
  isPostOverdue,
  POST_PLATFORMS,
  POST_STATUSES,
  type PostRights,
  type PostState,
  postContentToken,
  postMove,
  postMoveNeeds,
  postStatusChangeSchema,
  updatePostSchema,
} from './content.js';

const CLIENT = '0198f0c2-0000-7000-8000-000000000001';

const none: PostRights = { edit: false, review: false, client: false };
const editor: PostRights = { ...none, edit: true };
const reviewer: PostRights = { ...none, review: true };
const everything: PostRights = { edit: true, review: true, client: true };

function post(state: Partial<PostState> = {}): PostState {
  return { status: 'idea', reviewStage: null, needsClientApproval: true, hasWork: false, ...state };
}

describe('post platforms', () => {
  it('are the client platforms without website and other', () => {
    expect(POST_PLATFORMS).toEqual(
      CLIENT_PLATFORMS.filter((platform) => platform !== 'website' && platform !== 'other'),
    );
  });
});

describe('createPostSchema', () => {
  const base = {
    clientId: CLIENT,
    title: '  Ramadan offer  ',
    type: 'carousel',
    platforms: ['instagram', 'facebook', 'instagram'],
    publishDate: '2026-10-12',
  };

  it('trims the title, keeps platforms once and defaults the flag and the line', () => {
    const parsed = createPostSchema.parse(base);
    expect(parsed.title).toBe('Ramadan offer');
    expect(parsed.platforms).toEqual(['instagram', 'facebook']);
    expect(parsed.needsClientApproval).toBe(true);
    expect(parsed.cycleLineId).toBeNull();
    expect(parsed.responsibleId).toBeUndefined();
  });

  it('refuses no platform, an unknown platform and texts past their limits', () => {
    expect(createPostSchema.safeParse({ ...base, platforms: [] }).success).toBe(false);
    expect(createPostSchema.safeParse({ ...base, platforms: ['website'] }).success).toBe(false);
    expect(createPostSchema.safeParse({ ...base, title: 'x'.repeat(161) }).success).toBe(false);
    expect(createPostSchema.safeParse({ ...base, caption: 'x'.repeat(5001) }).success).toBe(false);
    expect(createPostSchema.safeParse({ ...base, hashtags: 'x'.repeat(1001) }).success).toBe(false);
    expect(createPostSchema.safeParse({ ...base, notes: 'x'.repeat(2001) }).success).toBe(false);
    expect(createPostSchema.safeParse({ ...base, publishTime: '25:00' }).success).toBe(false);
  });

  it('stores a blank caption as null', () => {
    expect(createPostSchema.parse({ ...base, caption: '   ' }).caption).toBeNull();
  });
});

describe('published links', () => {
  it('take one http(s) link per platform', () => {
    const links = [{ platform: 'instagram', url: 'https://instagram.com/p/1' }];
    expect(updatePostSchema.parse({ publishedLinks: links }).publishedLinks).toEqual(links);
    expect(updatePostSchema.safeParse({ publishedLinks: [...links, ...links] }).success).toBe(
      false,
    );
    expect(
      updatePostSchema.safeParse({
        publishedLinks: [{ platform: 'instagram', url: 'ftp://example.com/x' }],
      }).success,
    ).toBe(false);
  });
});

describe('postStatusChangeSchema', () => {
  it('needs a reason to cancel', () => {
    expect(postStatusChangeSchema.safeParse({ to: 'cancelled' }).success).toBe(false);
    expect(postStatusChangeSchema.safeParse({ to: 'cancelled', reason: '  ' }).success).toBe(false);
    expect(postStatusChangeSchema.safeParse({ to: 'cancelled', reason: 'Dropped' }).success).toBe(
      true,
    );
  });
});

describe('contentCalendarQuerySchema', () => {
  it('takes a range of at most 45 days', () => {
    expect(
      contentCalendarQuerySchema.safeParse({ from: '2026-10-01', to: '2026-11-14' }).success,
    ).toBe(true);
    expect(
      contentCalendarQuerySchema.safeParse({ from: '2026-10-01', to: '2026-11-15' }).success,
    ).toBe(false);
    expect(
      contentCalendarQuerySchema.safeParse({ from: '2026-10-02', to: '2026-10-01' }).success,
    ).toBe(false);
  });

  it('takes one status or several', () => {
    const query = { from: '2026-10-01', to: '2026-10-31' };
    expect(contentCalendarQuerySchema.parse({ ...query, status: 'idea' }).status).toEqual(['idea']);
  });
});

describe('post transitions', () => {
  it('names every move of the status diagram and nothing else', () => {
    const moves = POST_STATUSES.flatMap((from) =>
      POST_STATUSES.map((to) => [`${from}>${to}`, postMove(from, to)] as const),
    ).filter(([, move]) => move !== null);
    expect(Object.fromEntries(moves)).toEqual({
      'idea>in_production': 'start',
      'idea>internal_review': 'submit',
      'idea>cancelled': 'cancel',
      'in_production>internal_review': 'submit',
      'in_production>cancelled': 'cancel',
      'internal_review>in_production': 'return',
      'internal_review>awaiting_client': 'send_to_client',
      'internal_review>approved': 'approve',
      'internal_review>cancelled': 'cancel',
      'awaiting_client>in_production': 'client_changes',
      'awaiting_client>internal_review': 'withdraw',
      'awaiting_client>approved': 'client_approved',
      'awaiting_client>cancelled': 'cancel',
      'approved>in_production': 'reopen_content',
      'approved>scheduled': 'schedule',
      'approved>published': 'publish',
      'approved>cancelled': 'cancel',
      'scheduled>in_production': 'reopen_content',
      'scheduled>approved': 'unschedule',
      'scheduled>published': 'publish',
      'scheduled>cancelled': 'cancel',
      'cancelled>idea': 'reopen',
      'cancelled>in_production': 'reopen',
    });
  });

  it('asks for a note on returns and a reason on cancel and reopen content', () => {
    expect(postMoveNeeds('return')).toBe('note');
    expect(postMoveNeeds('client_changes')).toBe('note');
    expect(postMoveNeeds('cancel')).toBe('reason');
    expect(postMoveNeeds('reopen_content')).toBe('reason');
    expect(postMoveNeeds('withdraw')).toBeNull();
    expect(postMoveNeeds('publish')).toBeNull();
  });

  it('gives production and publishing moves to edit scope only', () => {
    expect(allowedPostTransitions(post(), editor)).toEqual([
      'in_production',
      'internal_review',
      'cancelled',
    ]);
    expect(allowedPostTransitions(post(), reviewer)).toEqual([]);
    expect(allowedPostTransitions(post({ status: 'approved' }), editor)).toEqual([
      'in_production',
      'scheduled',
      'published',
      'cancelled',
    ]);
    expect(allowedPostTransitions(post({ status: 'published' }), everything)).toEqual([]);
  });

  it('passes an internal review by the flag, and leaves the medical pass to its route', () => {
    const internal = post({ status: 'internal_review', reviewStage: 'internal' });
    expect(allowedPostTransitions(internal, reviewer)).toEqual([
      'in_production',
      'awaiting_client',
    ]);
    expect(allowedPostTransitions({ ...internal, needsClientApproval: false }, reviewer)).toEqual([
      'in_production',
      'approved',
    ]);
    const medical = post({ status: 'internal_review', reviewStage: 'medical' });
    expect(allowedPostTransitions(medical, reviewer)).toEqual(['in_production']);
    expect(canMakePostMove(internal, 'send_to_client', editor)).toBe(false);
  });

  it('keeps the client response to client scope and the withdraw to review scope', () => {
    const awaiting = post({ status: 'awaiting_client' });
    expect(allowedPostTransitions(awaiting, { ...none, client: true })).toEqual([
      'in_production',
      'approved',
    ]);
    expect(allowedPostTransitions(awaiting, reviewer)).toEqual(['internal_review']);
  });

  it('reopens a cancelled post to idea, or to production when it has work', () => {
    expect(allowedPostTransitions(post({ status: 'cancelled' }), editor)).toEqual(['idea']);
    expect(allowedPostTransitions(post({ status: 'cancelled', hasWork: true }), editor)).toEqual([
      'in_production',
    ]);
  });
});

describe('postContentToken', () => {
  const versions = ['0198f0c2-0000-7000-8000-00000000000a', '0198f0c2-0000-7000-8000-00000000000b'];

  it('changes with the media, the caption and the hashtags', () => {
    const token = postContentToken(versions, 'Caption', '#tag');
    expect(postContentToken(versions, 'Caption', '#tag')).toBe(token);
    expect(postContentToken(versions.slice(0, 1), 'Caption', '#tag')).not.toBe(token);
    expect(postContentToken(versions, 'Caption 2', '#tag')).not.toBe(token);
    expect(postContentToken(versions, 'Caption', '#other')).not.toBe(token);
  });

  it('tells the caption from the hashtags', () => {
    expect(postContentToken([], 'a', null)).not.toBe(postContentToken([], null, 'a'));
  });
});

describe('isPostOverdue', () => {
  const now = new Date('2026-10-10T09:00:00Z');

  it('marks approved and scheduled posts whose publish date passed', () => {
    expect(isPostOverdue({ status: 'approved', publishDate: '2026-10-09' }, now)).toBe(true);
    expect(isPostOverdue({ status: 'scheduled', publishDate: '2026-10-09' }, now)).toBe(true);
    expect(isPostOverdue({ status: 'approved', publishDate: '2026-10-10' }, now)).toBe(false);
    expect(isPostOverdue({ status: 'published', publishDate: '2026-10-01' }, now)).toBe(false);
    expect(isPostOverdue({ status: 'in_production', publishDate: '2026-10-01' }, now)).toBe(false);
  });
});
