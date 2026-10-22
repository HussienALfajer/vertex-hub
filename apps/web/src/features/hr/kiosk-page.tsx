import {
  ATTENDANCE_CODE_WINDOW_SECONDS,
  type AttendanceGreeting,
  attendanceGreetingSchema,
  GREETING_SECONDS,
  KIOSK_STREAM_PING_MS,
  type KioskCodeEvent,
  kioskCodeEventSchema,
  PAIRING_CODE_LENGTH,
  type PairedKiosk,
  pairedKioskSchema,
  pairKioskSchema,
} from '@vertex-hub/contracts';
import {
  Button,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Progress,
  Skeleton,
  VertexLogo,
} from '@vertex-hub/ui';
import { WifiOffIcon } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { ApiError, api, call } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatTime } from '../../lib/format';
import { GreetingView } from './attendance-parts';

/** How long the screen waits before connecting again after the stream drops. */
const RECONNECT_MS = 3_000;

type Connection = 'connecting' | 'unpaired' | 'live';

/** Failed connections in a row before the "offline" banner shows (the stream also ends by design). */
const OFFLINE_AFTER = 2;

/**
 * A stream silent this long is dead (a restarted access point, a sleeping screen): the API sends
 * a code every 20 seconds and a ping every 30.
 */
const SILENT_MS = KIOSK_STREAM_PING_MS + 15_000;

interface StreamHandlers {
  /** Any bytes arrived: the connection is alive. */
  alive: () => void;
  kiosk: (kiosk: PairedKiosk) => void;
  code: (event: KioskCodeEvent) => void;
  greeting: (greeting: AttendanceGreeting) => void;
}

/**
 * Reads the screen's Server-Sent Events with `fetch`, so a 401 (not paired) is told apart from a
 * dropped connection. Resolves when the stream ends; `'unpaired'` when the API refuses it.
 */
async function readStream(
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<'unpaired' | 'ended'> {
  const response = await fetch('/api/kiosk/stream', {
    signal,
    credentials: 'same-origin',
    headers: { accept: 'text/event-stream' },
  });
  if (response.status === 401) return 'unpaired';
  if (!response.ok || !response.body) return 'ended';
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return 'ended';
    handlers.alive();
    buffer += value;
    let end = buffer.indexOf('\n\n');
    while (end >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      end = buffer.indexOf('\n\n');
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (!data) continue;
      const parsed: unknown = JSON.parse(data);
      if (event === 'kiosk') handlers.kiosk(pairedKioskSchema.parse(parsed));
      else if (event === 'code') handlers.code(kioskCodeEventSchema.parse(parsed));
      else if (event === 'greeting') handlers.greeting(attendanceGreetingSchema.parse(parsed));
    }
  }
}

/**
 * The entrance screen `/kiosk` (spec F17, rules C4, C5, C20): no user session. Unpaired, it takes
 * the pairing code; paired, it shows the logo, the clock, the rotating code with its countdown,
 * and the greeting after each office punch. The stream closes every 15 minutes and the
 * screen connects again; an "offline" banner shows once connecting has failed twice in a row.
 */
export function KioskPage() {
  const [connection, setConnection] = useState<Connection>('connecting');
  const [failures, setFailures] = useState(0);
  const [code, setCode] = useState<KioskCodeEvent | null>(null);
  const [greeting, setGreeting] = useState<AttendanceGreeting | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // `attempt` reconnects: a new pairing, or the retry after a drop.
    void attempt;
    const controller = new AbortController();
    let retry: number | undefined;
    let reached = false;
    let silent = false;
    let watchdog: number | undefined;
    const alive = () => {
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => {
        silent = true;
        controller.abort();
      }, SILENT_MS);
    };
    alive();
    readStream(controller.signal, {
      alive,
      kiosk: () => {
        reached = true;
        setConnection('live');
        setFailures(0);
      },
      code: setCode,
      greeting: setGreeting,
    })
      .catch(() => 'ended' as const)
      .then((outcome) => {
        window.clearTimeout(watchdog);
        if (controller.signal.aborted && !silent) return;
        if (outcome === 'unpaired') {
          setConnection('unpaired');
          return;
        }
        // A stream that went silent, or never opened, counts toward the banner.
        const failed = silent || !reached;
        if (failed) setFailures((n) => n + 1);
        retry = window.setTimeout(() => setAttempt((n) => n + 1), failed ? RECONNECT_MS : 1_000);
      });
    return () => {
      controller.abort();
      window.clearTimeout(retry);
      window.clearTimeout(watchdog);
    };
  }, [attempt]);

  useEffect(() => {
    if (!greeting) return;
    const timer = window.setTimeout(() => setGreeting(null), GREETING_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [greeting]);

  if (connection === 'unpaired') {
    return (
      <PairingForm
        onPaired={() => {
          setConnection('connecting');
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  return (
    <KioskDisplay
      offline={failures >= OFFLINE_AFTER}
      loading={connection === 'connecting'}
      code={code}
      greeting={greeting}
    />
  );
}

/** Rule C4: the 8-character code from HR settings, used once within 15 minutes. */
function PairingForm({ onPaired }: { onPaired: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  /** The server's refusal of the code; unset while the code's shape is the problem. */
  const [refused, setRefused] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    setRefused(null);
    const parsed = pairKioskSchema.safeParse({ code: value });
    if (!parsed.success) {
      setInvalid(true);
      field.current?.focus();
      return;
    }
    setPending(true);
    try {
      await call(api.POST('/api/kiosk/pair', { body: parsed.data }));
      onPaired();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_PAIRING_CODE') {
        setRefused(errorMessage(t, error));
        setInvalid(true);
        field.current?.focus();
      } else {
        setFailure(errorMessage(t, error));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <form className="flex w-full max-w-sm flex-col gap-5" onSubmit={submit} noValidate>
        <VertexLogo label={t('app.brand')} className="w-32 text-primary" />
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">{t('hr.kiosk.pairTitle')}</h1>
          <p className="text-muted-foreground">{t('hr.kiosk.pairHint')}</p>
        </div>
        <Field invalid={invalid}>
          <FieldLabel>{t('hr.kiosk.pairingCode')}</FieldLabel>
          <Input
            ref={field}
            dir="ltr"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={PAIRING_CODE_LENGTH}
            className="text-lg tabular-nums"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setInvalid(false);
              setRefused(null);
            }}
          />
          <FieldError match={invalid} role={refused ? 'alert' : undefined}>
            {refused ?? t('hr.kiosk.pairingCodeInvalid')}
          </FieldError>
        </Field>
        {failure && <FormAlert>{failure}</FormAlert>}
        <Button type="submit" disabled={pending}>
          {pending ? t('hr.kiosk.pairing') : t('hr.kiosk.pair')}
        </Button>
      </form>
    </main>
  );
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Rule C5: the bar empties as the code's 20 seconds run out. */
function Countdown({ code, now }: { code: KioskCodeEvent; now: Date }) {
  const { t } = useTranslation();
  const total = ATTENDANCE_CODE_WINDOW_SECONDS * 1000;
  const left = Math.max(0, Math.min(total, new Date(code.expiresAt).getTime() - now.getTime()));
  return (
    <Progress
      value={(left / total) * 100}
      aria-label={t('hr.kiosk.countdown')}
      className="w-[min(50vw,42vh)]"
    />
  );
}

function KioskDisplay({
  offline,
  loading,
  code,
  greeting,
}: {
  offline: boolean;
  loading: boolean;
  code: KioskCodeEvent | null;
  greeting: AttendanceGreeting | null;
}) {
  const { t } = useTranslation();
  const now = useNow(250);
  // A code past its window is no longer shown: the stream has stalled.
  const current = code && new Date(code.expiresAt).getTime() > now.getTime() - 5_000 ? code : null;

  return (
    <main
      className="flex min-h-dvh flex-col bg-background text-foreground"
      data-testid="kiosk-screen"
    >
      {offline && (
        <div
          role="alert"
          className="flex items-center justify-center gap-3 bg-status-danger px-4 py-3 text-xl font-medium text-status-danger-foreground"
        >
          <WifiOffIcon aria-hidden="true" className="size-6" />
          {t('hr.kiosk.offline')}
        </div>
      )}
      <header className="flex items-center justify-between gap-6 px-8 py-6">
        <VertexLogo label={t('app.brand')} className="w-40 text-primary" />
        <div className="text-end">
          <p className="text-4xl font-bold tabular-nums">{formatTime(now)}</p>
          <p className="text-2xl text-muted-foreground">{formatDate(now)}</p>
        </div>
      </header>
      <section className="flex flex-1 flex-col items-center justify-center gap-8 px-8 pb-10">
        {greeting ? (
          <GreetingView greeting={greeting} large />
        ) : (
          <>
            <div className="flex flex-col items-center gap-4">
              {/* Scanners read dark on light best, so the plate stays light in the dark theme. */}
              <div className="rounded-xl bg-white p-6 text-neutral-900">
                {loading || !current ? (
                  <Skeleton className="size-[min(50vw,42vh)]" />
                ) : (
                  <QRCodeSVG
                    value={`${window.location.origin}/attend#${current.code}`}
                    size={512}
                    level="M"
                    bgColor="transparent"
                    fgColor="currentColor"
                    className="size-[min(50vw,42vh)]"
                    data-testid="kiosk-code"
                    data-code={current.code}
                    title={t('hr.kiosk.codeLabel')}
                  />
                )}
              </div>
              {current && <Countdown code={current} now={now} />}
            </div>
            <p className="text-center text-3xl font-medium">{t('hr.kiosk.scanHint')}</p>
          </>
        )}
      </section>
    </main>
  );
}
