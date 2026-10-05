import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EmailResultJob, EmailSendJob, Notification } from '@vertex-hub/contracts';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../src/core/config/env.js';
import { renderEmail } from '../src/email/email-render.js';
import { EmailSender } from '../src/email/email-sender.js';
import { EmailSendJob as EmailSendWorker } from '../src/jobs/email-send.job.js';
import type { PgBossService } from '../src/jobs/pg-boss.service.js';

const job: EmailSendJob = {
  id: '0190a3c2-0000-7000-8000-0000000000e1',
  kind: 'test',
  to: [{ name: 'رنا', email: 'rana@example.com' }],
  cc: [{ name: 'Sami', email: 'sami@example.com' }],
  replyTo: null,
  subject: 'رسالة تجريبية من Vertex Hub',
  message: null,
  data: { requestedBy: 'رنا' },
  attachments: [],
  sealed: null,
};

const APP_URL = 'https://hub.example.com';

const notification = (id: string, type: 'task_assigned' | 'invoice_paid'): Notification =>
  ({
    id,
    type,
    actor: { id: '0190a3c2-0000-7000-8000-0000000000a1', name: 'ليان الأحمد' },
    subject: {
      type: type === 'invoice_paid' ? 'invoice' : 'task',
      id: '0190a3c2-0000-7000-8000-0000000000b1',
    },
    data:
      type === 'invoice_paid'
        ? { invoice: { displayNumber: 'INV-2026-0012', client: 'مطعم الشام' } }
        : {
            task: {
              title: 'تصاميم منيو الخريف',
              department: 'design',
              client: 'مطعم الشام',
              project: null,
            },
          },
    count: 1,
    read: false,
    createdAt: '2026-10-05T07:00:00.000Z',
    updatedAt: '2026-10-05T07:00:00.000Z',
  }) as Notification;

const task = {
  id: '0190a3c2-0000-7000-8000-0000000000c1',
  title: 'تصوير الأطباق',
  client: 'مطعم الشام',
  dueDate: '2026-10-01',
  dueTime: null,
  daysLate: 4,
};

/** One job of every staff kind, with fixed data so the snapshots hold. */
const STAFF_DATA: Partial<Record<EmailSendJob['kind'], Record<string, unknown>>> = {
  notification_batch: {
    notifications: {
      items: [
        notification('0190a3c2-0000-7000-8000-0000000000d1', 'task_assigned'),
        notification('0190a3c2-0000-7000-8000-0000000000d2', 'invoice_paid'),
      ],
      more: 3,
    },
    departments: { design: 'التصميم' },
  },
  digest: {
    date: '2026-10-05',
    overdue: { items: [task], more: 0 },
    dueToday: {
      items: [{ ...task, dueDate: '2026-10-05', dueTime: '14:00', daysLate: 0 }],
      more: 2,
    },
    notifications: {
      items: [notification('0190a3c2-0000-7000-8000-0000000000d3', 'task_assigned')],
      more: 0,
    },
    unreadCount: 7,
    departments: {},
  },
  account_activation: {
    name: 'رنا',
    link: 'https://hub.example.com/activate#token=abc',
    expiresAt: '2026-10-08T07:00:00.000Z',
    restored: false,
  },
  password_reset: {
    name: 'رنا',
    link: 'https://hub.example.com/activate#token=abc',
    expiresAt: '2026-10-05T08:00:00.000Z',
    requested: true,
  },
  security_notice: {
    name: 'رنا',
    change: 'roles_changed',
    at: '2026-10-05T07:00:00.000Z',
    by: 'سامي',
  },
  new_device: {
    name: 'رنا',
    device: 'Chrome · Windows',
    ip: '203.0.113.7',
    at: '2026-10-05T07:00:00.000Z',
  },
};

/** What the API does to token links (ADR 0028), for the worker to undo. */
function seal(secrets: Record<string, unknown>, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secrets)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

describe('email templates', () => {
  it('renders the test email as RTL Arabic HTML and plain text', async () => {
    const { html, text } = await renderEmail(job, APP_URL);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('cid:logo@vertexmedia.pro');
    expect(html).toMatchSnapshot();
    expect(text).toMatchSnapshot();
  });

  it.each(Object.entries(STAFF_DATA))('renders the %s email', async (kind, data) => {
    const { html, text } = await renderEmail(
      { kind: kind as EmailSendJob['kind'], data: data ?? {} },
      APP_URL,
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toMatchSnapshot();
    expect(text).toMatchSnapshot();
  });

  it('links each notification and the settings into the web app (rule 9)', async () => {
    const { html } = await renderEmail(
      { kind: 'notification_batch', data: STAFF_DATA.notification_batch ?? {} },
      APP_URL,
    );
    expect(html).toContain('https://hub.example.com/tasks/0190a3c2-0000-7000-8000-0000000000b1');
    expect(html).toContain('https://hub.example.com/notifications/settings');
    expect(html).toContain('https://hub.example.com/notifications');
  });

  it('has no template for a kind that is not sent yet', async () => {
    await expect(renderEmail({ kind: 'client_quote', data: {} }, APP_URL)).rejects.toThrow(
      'No template',
    );
  });
});

describe('log transport', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vertex-emails-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the message as an .eml file and sends nothing (rule 24)', async () => {
    const sender = new EmailSender(
      parseEnv({ ...process.env, EMAIL_TRANSPORT: 'log', EMAIL_LOG_DIR: dir }),
    );
    await sender.send(job);
    const eml = await readFile(join(dir, `${job.id}.eml`), 'utf8');
    expect(eml).toContain('From: Vertex Hub <info@vertexmedia.pro>');
    expect(eml).toContain('rana@example.com');
    expect(eml).toContain('Cc: Sami <sami@example.com>');
    expect(eml).toContain('Content-ID: <logo@vertexmedia.pro>');
    expect(eml).toContain('text/plain');
  });

  it('puts the sealed link back, and refuses a key that does not match (ADR 0028)', async () => {
    const env = parseEnv({ ...process.env, EMAIL_TRANSPORT: 'log', EMAIL_LOG_DIR: dir });
    const link = 'https://hub.example.com/activate#token=sealed-secret';
    const activation: EmailSendJob = {
      ...job,
      id: '0190a3c2-0000-7000-8000-0000000000e2',
      kind: 'account_activation',
      subject: 'فعّل حسابك في Vertex Hub',
      data: { ...STAFF_DATA.account_activation, link: '[redacted]' },
      sealed: seal({ link }, env.EMAIL_SECRET_KEY),
    };
    await new EmailSender(env).send(activation);
    const eml = await readFile(join(dir, `${activation.id}.eml`), 'utf8');
    // Quoted-printable bodies wrap long lines with a trailing "=".
    expect(eml.replace(/=\r?\n/g, '')).toContain('sealed-secret');
    expect(eml).not.toContain('[redacted]');
    const wrongKey = { ...activation, sealed: seal({ link }, randomBytes(32)) };
    await expect(new EmailSender(env).send(wrongKey)).rejects.toThrow();
  });
});

describe('smtp transport', () => {
  const received: { from: string; to: string[]; raw: string }[] = [];
  let server: SMTPServer;
  let port: number;

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onAuth: (auth, _session, callback) => {
        if (auth.username === 'info@vertexmedia.pro' && auth.password === 'secret') {
          callback(null, { user: auth.username });
        } else {
          callback(new Error('Invalid login'));
        }
      },
      onData: (stream, session, callback) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => {
          received.push({
            from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
            to: session.envelope.rcptTo.map((rcpt) => rcpt.address),
            raw: Buffer.concat(chunks).toString('utf8'),
          });
          callback();
        });
      },
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    port = (server.server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  const smtpSender = (password: string) =>
    new EmailSender(
      parseEnv({
        ...process.env,
        EMAIL_TRANSPORT: 'smtp',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(port),
        SMTP_SECURE: 'false',
        SMTP_USER: 'info@vertexmedia.pro',
        SMTP_PASSWORD: password,
      }),
    );

  it('authenticates and delivers to every recipient', async () => {
    const { messageId } = await smtpSender('secret').send(job);
    expect(messageId).toMatch(/^<.+>$/);
    expect(received).toHaveLength(1);
    expect(received[0]?.from).toBe('info@vertexmedia.pro');
    expect(received[0]?.to).toEqual(['rana@example.com', 'sami@example.com']);
    expect(received[0]?.raw).toContain('From: Vertex Hub <info@vertexmedia.pro>');
  });

  it('throws the server refusal, for the job to retry', async () => {
    await expect(smtpSender('wrong').send(job)).rejects.toThrow();
  });
});

describe('email.send job', () => {
  const sent: EmailResultJob[] = [];
  const pgBoss = {
    boss: {
      send: vi.fn(async (_queue: string, data: EmailResultJob) => {
        sent.push(data);
        return null;
      }),
    },
  } as unknown as PgBossService;

  it('reports sent with the attempt it took', async () => {
    const sender = { send: async () => ({ messageId: '<m@vertex>' }) } as unknown as EmailSender;
    const result = await new EmailSendWorker(pgBoss, sender).handle(job, 1);
    expect(result).toMatchObject({ status: 'sent', attempts: 2, providerMessageId: '<m@vertex>' });
    expect(sent.at(-1)).toEqual(result);
  });

  it('lets pg-boss retry, then reports failed after the last retry (edge case 1)', async () => {
    const sender = {
      send: async () => {
        throw new Error('535 Authentication failed');
      },
    } as unknown as EmailSender;
    const worker = new EmailSendWorker(pgBoss, sender);
    const before = sent.length;
    await expect(worker.handle(job, 0)).rejects.toThrow('535');
    await expect(worker.handle(job, 2)).rejects.toThrow('535');
    expect(sent.length).toBe(before);
    const result = await worker.handle(job, 3);
    expect(result).toEqual({
      id: job.id,
      status: 'failed',
      attempts: 4,
      error: '535 Authentication failed',
    });
    expect(sent.at(-1)).toEqual(result);
  });
});
