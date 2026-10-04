import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { type EmailSendJob, emailAudienceOf } from '@vertex-hub/contracts';
import { EMAIL_SENDER_NAMES } from '@vertex-hub/messages';
import nodemailer, { type Transporter } from 'nodemailer';
import { ENV, type Env } from '../core/config/env.js';
import { repositoryRoot } from '../pdf/pdf-renderer.js';
import { LOGO_CID } from './email-layout.js';
import { renderEmail } from './email-render.js';

/** The logo emails show (brand/identity.md §7): the green full logo, as PNG for mail clients. */
const LOGO = 'brand/logo/png/vertex-logo-green.png';

type EmailEnv = Pick<
  Env,
  | 'EMAIL_TRANSPORT'
  | 'EMAIL_FROM'
  | 'EMAIL_LOG_DIR'
  | 'SMTP_HOST'
  | 'SMTP_PORT'
  | 'SMTP_SECURE'
  | 'SMTP_USER'
  | 'SMTP_PASSWORD'
>;

/**
 * Renders and sends one email of the outbox (F14 email rule 24, ADR 0028): over SMTP, or with
 * the `log` transport, which writes the message as `<id>.eml` under `EMAIL_LOG_DIR` and sends
 * nothing.
 */
@Injectable()
export class EmailSender {
  private readonly transport: Transporter;
  private logo: Buffer | undefined;

  constructor(@Inject(ENV) private readonly env: EmailEnv) {
    this.transport =
      env.EMAIL_TRANSPORT === 'smtp'
        ? nodemailer.createTransport({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
          })
        : nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  }

  /** Sends the email; returns the SMTP message id. Throws when the server refuses it. */
  async send(job: EmailSendJob): Promise<{ messageId: string | null }> {
    const { html, text } = await renderEmail(job);
    this.logo ??= await readFile(join(repositoryRoot(), LOGO));
    const info = await this.transport.sendMail({
      from: { name: EMAIL_SENDER_NAMES[emailAudienceOf(job.kind)], address: this.env.EMAIL_FROM },
      to: job.to.map(({ name, email }) => ({ name, address: email })),
      cc: job.cc.map(({ name, email }) => ({ name, address: email })),
      replyTo: job.replyTo ?? undefined,
      subject: job.subject,
      html,
      text,
      attachments: [{ filename: 'vertex-media.png', content: this.logo, cid: LOGO_CID }],
    });
    if (this.env.EMAIL_TRANSPORT === 'log') {
      const dir = resolve(this.env.EMAIL_LOG_DIR);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${job.id}.eml`), info.message as Buffer);
    }
    return { messageId: typeof info.messageId === 'string' ? info.messageId : null };
  }
}
