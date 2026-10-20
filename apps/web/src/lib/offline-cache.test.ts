import { describe, expect, it } from 'vitest';
import { isOfflineQuery } from './offline-cache';

describe('isOfflineQuery (F16 rule A5)', () => {
  it('keeps the listed modules and their children', () => {
    expect(isOfflineQuery(['me'])).toBe(true);
    expect(isOfflineQuery(['tasks', 'list', { page: 1 }])).toBe(true);
    expect(isOfflineQuery(['projects', 'list', {}])).toBe(true);
    expect(isOfflineQuery(['notifications', 'unread-count'])).toBe(true);
    expect(isOfflineQuery(['reports', 'dashboard', 'departments', 'design'])).toBe(true);
  });

  it('never keeps financial data', () => {
    for (const key of [
      ['invoices', 'list', {}],
      ['quotes', 'detail', 'q1'],
      ['retainers', 'detail', 'r1'],
      ['campaigns', 'wallets', {}],
      ['catalog', 'services', {}],
      ['leads', 'board', {}],
      ['projects', 'detail', 'p1'],
      ['reports', 'dashboard', 'finance'],
      ['reports', 'dashboard', 'company'],
      ['reports', 'revenue', {}],
      ['audit', 'list', {}],
      ['notifications', 'list', {}],
    ]) {
      expect(isOfflineQuery(key), key.join('/')).toBe(false);
    }
  });

  it('leaves out the client approval page, keyed by its link token', () => {
    expect(isOfflineQuery(['approvals', 'requests', {}])).toBe(true);
    expect(isOfflineQuery(['approvals', 'public', 'token'])).toBe(false);
  });

  it('leaves out a module nobody listed', () => {
    expect(isOfflineQuery(['announcements', 'list'])).toBe(false);
  });
});
