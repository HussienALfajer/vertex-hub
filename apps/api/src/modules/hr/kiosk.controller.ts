import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import {
  attendanceCodeWindow,
  attendanceCodeWindowEnd,
  KIOSK_STREAM_LIFETIME_MS,
  KIOSK_STREAM_PING_MS,
  type KioskCodeEvent,
  type PairedKiosk,
  type PairKiosk,
  pairedKioskSchema,
  pairKioskSchema,
} from '@vertex-hub/contracts';
import { ENV, type Env } from '../../core/config/env.js';
import { clientIpOf } from '../auth/index.js';
import { AttendanceKiosksService } from './attendance-kiosks.service.js';
import { KioskStream } from './kiosk-stream.js';

/** Rule C4: the cookie that names a paired entrance screen. */
const KIOSK_COOKIE = 'vh_kiosk';

/** 400 days, the longest a browser keeps a cookie. */
const KIOSK_COOKIE_SECONDS = 400 * 24 * 60 * 60;

const addressOf = (request: IncomingMessage) =>
  clientIpOf(request.headers['x-forwarded-for'], request.socket.remoteAddress);

function kioskCookieOf(request: IncomingMessage): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === KIOSK_COOKIE && value) return value;
  }
  return null;
}

/**
 * The entrance screen (rules C4, C5, C20, ADR 0039): no user session. Pairing sets its
 * `HttpOnly` cookie; the stream sends the code of each 20-second window, computed here so the
 * secret never reaches the browser, and the greeting after an office punch. Each ping marks the
 * screen as seen from its address (rule C6). nginx rate-limits the pairing.
 */
@ApiTags('hr')
@AllowAnonymous()
@Controller('kiosk')
export class KioskController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly kiosks: AttendanceKiosksService,
    private readonly stream: KioskStream,
  ) {}

  @Post('pair')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Paired; sets the `vh_kiosk` cookie',
    standardSchema: pairedKioskSchema,
  })
  async pair(
    @Body({ schema: pairKioskSchema }) input: PairKiosk,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<PairedKiosk> {
    const { token, kiosk } = await this.kiosks.pair(input.code, addressOf(request));
    response.setHeader(
      'set-cookie',
      [
        `${KIOSK_COOKIE}=${token}`,
        'Path=/api/kiosk',
        `Max-Age=${KIOSK_COOKIE_SECONDS}`,
        'HttpOnly',
        'SameSite=Strict',
        ...(this.env.APP_URL.startsWith('https://') ? ['Secure'] : []),
      ].join('; '),
    );
    return kiosk;
  }

  /**
   * Server-Sent Events: `kiosk` once (the screen's id and name), `code` at each window
   * (`KioskCodeEvent`), `greeting` after a punch here (`AttendanceGreeting`), a `: ping` every
   * 30 seconds; closed after 15 minutes or when the screen is unpaired, so it reconnects.
   */
  @Get('stream')
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description: '`kiosk`, `code` and `greeting` events; 401 without a paired screen',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  async openStream(
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const kiosk = await this.kiosks.byToken(kioskCookieOf(request));
    if (!kiosk) throw new UnauthorizedException();
    const address = addressOf(request);
    await this.stream.connect();
    await this.kiosks.touch(kiosk.id, address);
    if (request.destroyed) return;
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    let closed = false;
    let windowTimer: NodeJS.Timeout | undefined;
    const send = (event: string, data: unknown) =>
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(windowTimer);
      clearInterval(ping);
      clearTimeout(lifetime);
      unsubscribe();
      response.end();
    };
    const sendCode = async () => {
      const now = new Date();
      const window = attendanceCodeWindow(now);
      const expiresAt = attendanceCodeWindowEnd(window);
      const event: KioskCodeEvent = {
        code: await this.kiosks.code(kiosk, window),
        window,
        expiresAt: expiresAt.toISOString(),
      };
      if (closed) return;
      send('code', event);
      windowTimer = setTimeout(
        () => void sendCode().catch(close),
        Math.max(expiresAt.getTime() - Date.now(), 0) + 50,
      );
    };
    const unsubscribe = this.stream.subscribe(kiosk.id, {
      greet: (greeting) => send('greeting', greeting),
      close,
    });
    const ping = setInterval(() => {
      response.write(': ping\n\n');
      this.kiosks.byToken(kioskCookieOf(request)).then(
        (current) => (current?.id === kiosk.id ? this.kiosks.touch(kiosk.id, address) : close()),
        () => close(),
      );
    }, KIOSK_STREAM_PING_MS);
    const lifetime = setTimeout(close, KIOSK_STREAM_LIFETIME_MS);
    request.on('close', close);
    send('kiosk', { id: kiosk.id, name: kiosk.name });
    await sendCode().catch(close);
  }
}
