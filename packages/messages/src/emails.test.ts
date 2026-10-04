import { describe, expect, it } from 'vitest';
import { testEmail } from './emails.js';

describe('test email', () => {
  it('names who asked for it', () => {
    const content = testEmail({ requestedBy: 'رنا' });
    expect(content.subject).toBe('رسالة تجريبية من Vertex Hub');
    expect(content.paragraphs[0]).toContain('رنا');
  });
});
