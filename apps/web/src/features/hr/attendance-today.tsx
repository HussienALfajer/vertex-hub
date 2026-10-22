import { useQuery } from '@tanstack/react-query';
import {
  ATTENDANCE_LIMITS,
  type AttendanceGreeting,
  type FieldWork,
  GREETING_SECONDS,
  type MyAttendanceToday,
  type PunchableShoot,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
  Skeleton,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import {
  BriefcaseIcon,
  CameraIcon,
  FingerprintIcon,
  HouseIcon,
  InfoIcon,
  LogOutIcon,
  TriangleAlertIcon,
  VideoIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { formatTime, formatWeekdayDate } from '../../lib/format';
import { ChoiceSelect } from '../quotes/choice-select';
import { FormDialog } from '../quotes/quote-dialogs';
import { Expectations } from './attendance-month';
import { DayStatusBadge, GreetingView, PunchTimeline } from './attendance-parts';
import {
  PasskeyCancelled,
  type PunchRequest,
  supportsPasskeys,
  useAttendancePunch,
  usePasskeyRegistration,
} from './attendance-punch';
import { AttendanceScanner } from './attendance-scanner';
import { myAttendanceTodayQuery } from './hr.queries';

/** A punch failure in plain Arabic: the API's code, or the cancelled passkey prompt. */
export function punchFailure(t: TFunction, error: unknown): string {
  if (error instanceof PasskeyCancelled) return t('hr.attendance.passkeyCancelled');
  return errorMessage(t, error);
}

/**
 * Runs punches in their two taps (`useAttendancePunch`) and shows the greeting for 8 seconds
 * (rule C20), or why they failed. `run` prepares; `PunchConfirmDialog` asks for the second tap.
 */
export function usePunchWithGreeting() {
  const { t } = useTranslation();
  const punch = useAttendancePunch();
  const [greeting, setGreeting] = useState<AttendanceGreeting | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function run(request: PunchRequest): Promise<boolean> {
    setFailure(null);
    try {
      await punch.prepare(request);
      return true;
    } catch (error) {
      setFailure(punchFailure(t, error));
      return false;
    }
  }

  async function confirm(): Promise<void> {
    setFailure(null);
    try {
      setGreeting((await punch.confirm()).greeting);
    } catch (error) {
      setFailure(punchFailure(t, error));
    }
  }

  return {
    run,
    confirm,
    cancel: punch.cancel,
    prepared: punch.prepared,
    step: punch.step,
    busy: punch.busy,
    greeting,
    setGreeting,
    failure,
  };
}

/** The second tap of a punch: it opens the passkey prompt (the phone's fingerprint or face). */
export function PunchConfirmDialog({
  punch,
  direction,
}: {
  punch: ReturnType<typeof usePunchWithGreeting>;
  direction: 'in' | 'out';
}) {
  const { t } = useTranslation();
  const method = punch.prepared?.request.method;
  return (
    <Dialog
      open={punch.prepared !== null}
      onOpenChange={(next) => !next && punch.step === 'ready' && punch.cancel()}
    >
      <DialogContent closeLabel={t('common.close')} className="max-w-md">
        <DialogTitle>
          {t(direction === 'out' ? 'hr.attendance.confirm.out' : 'hr.attendance.confirm.in')}
        </DialogTitle>
        {method && (
          <p className="text-muted-foreground">{t(`hr.attendance.confirm.methods.${method}`)}</p>
        )}
        <Button
          size="lg"
          disabled={punch.step !== 'ready'}
          onClick={() => void punch.confirm()}
          data-testid="punch-confirm"
        >
          <FingerprintIcon />
          {punch.step === 'ready'
            ? t('hr.attendance.confirm.action')
            : t(`hr.attendance.steps.${punch.step}`)}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/** The greeting after a punch, closed after 8 seconds or by the person. */
export function GreetingDialog({
  greeting,
  onClose,
}: {
  greeting: AttendanceGreeting | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!greeting) return;
    const timer = window.setTimeout(onClose, GREETING_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [greeting, onClose]);
  return (
    <Dialog open={greeting !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-md py-10">
        <DialogTitle className="sr-only">{t('hr.attendance.greeting.title')}</DialogTitle>
        {greeting && <GreetingView greeting={greeting} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The Today card (spec screen "My attendance"): the day's expectations and punches, and one main
 * button by state — scan the entrance code, check in remotely, field work, a shoot check-in, or
 * check out. Exempt, holiday, leave and trial days explain themselves.
 */
export function TodayCard() {
  const { t } = useTranslation();
  const today = useQuery(myAttendanceTodayQuery);
  const punch = usePunchWithGreeting();
  const [scanning, setScanning] = useState(false);
  const [fieldOpen, setFieldOpen] = useState(false);
  const fieldButton = useRef<HTMLButtonElement>(null);
  const closeGreeting = useCallback(() => punch.setGreeting(null), [punch.setGreeting]);
  const onCode = useCallback(
    (code: string) => {
      setScanning(false);
      void punch.run({ method: 'office', code });
    },
    [punch.run],
  );

  if (today.isPending) return <Skeleton className="h-64" />;
  if (today.isError) {
    return (
      <LoadError message={t('hr.attendance.today.loadError')} onRetry={() => today.refetch()} />
    );
  }
  const data = today.data;
  const out = data.nextDirection === 'out';
  const canPunch = !data.exemption && data.passkey.active;

  return (
    <Card className="flex flex-col gap-5" data-testid="today-card">
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <CardTitle className="me-auto">{formatWeekdayDate(data.date)}</CardTitle>
        {data.day && <DayStatusBadge status={data.day.status} />}
      </CardHeader>
      {data.day && (
        <CardDescription>
          <Expectations day={data.day} />
        </CardDescription>
      )}

      <TodayNotice data={data} />

      {canPunch && (
        <div className="flex flex-col gap-3">
          <Button
            size="lg"
            disabled={punch.busy}
            onClick={() => setScanning(true)}
            data-testid="punch-office"
          >
            {out ? <LogOutIcon /> : <CameraIcon />}
            {punch.busy
              ? t(`hr.attendance.steps.${punch.step}`)
              : out
                ? t('hr.attendance.actions.scanOut')
                : t('hr.attendance.actions.scanIn')}
          </Button>
          <div className="flex flex-wrap gap-2">
            {data.methods.includes('remote') && (
              <Button
                variant="outline"
                disabled={punch.busy}
                onClick={() => void punch.run({ method: 'remote' })}
              >
                <HouseIcon />
                {out ? t('hr.attendance.actions.remoteOut') : t('hr.attendance.actions.remoteIn')}
              </Button>
            )}
            {data.methods.includes('field') && (
              <Button
                ref={fieldButton}
                variant="outline"
                disabled={punch.busy}
                onClick={() => setFieldOpen(true)}
              >
                <BriefcaseIcon />
                {t('hr.attendance.actions.field')}
              </Button>
            )}
            {data.shoots.map((shoot) => (
              <ShootButton
                key={shoot.id}
                shoot={shoot}
                out={out}
                disabled={punch.busy}
                onClick={() => void punch.run({ method: 'shoot', shootId: shoot.id })}
              />
            ))}
          </div>
        </div>
      )}

      {punch.failure && (
        <Callout
          tone="danger"
          icon={<TriangleAlertIcon />}
          title={punch.failure}
          role="alert"
          data-testid="punch-failure"
        />
      )}

      {data.day && <PunchTimeline punches={data.day.punches} />}

      <AttendanceScanner open={scanning} onClose={() => setScanning(false)} onCode={onCode} />
      <FieldPunchDialog
        open={fieldOpen}
        onClose={() => setFieldOpen(false)}
        finalFocus={() => fieldButton.current ?? true}
        fieldWork={data.fieldWork}
        onPunch={(request) => punch.run(request)}
        failure={punch.failure}
      />
      <PunchConfirmDialog punch={punch} direction={data.nextDirection} />
      <GreetingDialog greeting={punch.greeting} onClose={closeGreeting} />
    </Card>
  );
}

function ShootButton({
  shoot,
  out,
  disabled,
  onClick,
}: {
  shoot: PunchableShoot;
  out: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button variant="outline" disabled={disabled} onClick={onClick}>
      <VideoIcon />
      {t(out ? 'hr.attendance.actions.shootOut' : 'hr.attendance.actions.shootIn', {
        title: shoot.title,
        time: formatTime(shoot.startsAt),
      })}
    </Button>
  );
}

/** Why the day takes no punch, or what kind of day it is. */
function TodayNotice({ data }: { data: MyAttendanceToday }) {
  const { t } = useTranslation();
  if (data.exemption) {
    return (
      <Callout
        icon={<InfoIcon />}
        title={t(`hr.attendance.exemptions.${data.exemption}`)}
        data-testid="today-notice"
      />
    );
  }
  if (!data.passkey.active) {
    return (
      <Callout
        tone="warning"
        icon={<FingerprintIcon />}
        title={
          data.passkey.pending
            ? t('hr.attendance.passkey.waitingTitle')
            : t('hr.attendance.passkey.missingTitle')
        }
        description={
          data.passkey.pending
            ? t('hr.attendance.passkey.waitingHint')
            : t('hr.attendance.passkey.missingHint')
        }
        data-testid="today-notice"
      />
    );
  }
  const status = data.day?.status;
  const notice =
    status === 'holiday' || status === 'leave' || status === 'off'
      ? t(`hr.attendance.notices.${status}`)
      : data.trial
        ? t('hr.attendance.notices.trial')
        : null;
  return notice ? <Callout icon={<InfoIcon />} title={notice} data-testid="today-notice" /> : null;
}

const NO_WORK = 'none';

/**
 * Rule C11: field work needs a reason and the location, and may name a task due today or one of
 * today's meetings; the passkey confirms it.
 */
function FieldPunchDialog({
  open,
  onClose,
  finalFocus,
  fieldWork,
  onPunch,
  failure,
}: {
  open: boolean;
  onClose: () => void;
  finalFocus: () => HTMLElement | boolean;
  fieldWork: readonly FieldWork[];
  onPunch: (request: PunchRequest) => Promise<boolean>;
  failure: string | null;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [work, setWork] = useState(NO_WORK);
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const items = [
    { value: NO_WORK, label: t('hr.attendance.field.noWork') },
    ...fieldWork.map((item) => ({
      value: `${item.kind}:${item.id}`,
      label: item.startsAt
        ? t('hr.attendance.field.meeting', { title: item.title, time: formatTime(item.startsAt) })
        : t('hr.attendance.field.task', { title: item.title }),
    })),
  ];

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onClosed={() => {
        setNote('');
        setWork(NO_WORK);
        setMissing(false);
      }}
      finalFocus={finalFocus}
      submitting={pending}
      title={t('hr.attendance.field.title')}
      description={t('hr.attendance.field.hint')}
      action={t('hr.attendance.field.submit')}
      failure={open && !pending ? failure : null}
      onSubmit={async (event) => {
        event?.preventDefault();
        if (!note.trim()) {
          setMissing(true);
          field.current?.focus();
          return;
        }
        const [kind, id] = work.split(':');
        setPending(true);
        const done = await onPunch({
          method: 'field',
          fieldNote: note.trim(),
          fieldWork: (kind === 'task' || kind === 'meeting') && id ? { kind, id } : undefined,
        });
        setPending(false);
        if (done) onClose();
      }}
    >
      <Field invalid={missing}>
        <FieldLabel>{t('hr.attendance.field.note')}</FieldLabel>
        <Textarea
          ref={field}
          rows={2}
          maxLength={ATTENDANCE_LIMITS.fieldNote}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setMissing(false);
          }}
        />
        <FieldError match={missing}>{t('hr.attendance.field.noteRequired')}</FieldError>
      </Field>
      {fieldWork.length > 0 && (
        <Field>
          <FieldLabel>{t('hr.attendance.field.work')}</FieldLabel>
          <ChoiceSelect
            label={t('hr.attendance.field.work')}
            items={items}
            value={work}
            onChange={setWork}
          />
        </Field>
      )}
      <p className="text-sm text-muted-foreground">{t('hr.attendance.field.location')}</p>
    </FormDialog>
  );
}

/**
 * Passkey setup and its state (rules C3, C9, C10): register on this phone, or a replacement for a
 * new phone that waits for the GM.
 */
export function PasskeyCard() {
  const { t } = useTranslation();
  const today = useQuery(myAttendanceTodayQuery);
  const registration = usePasskeyRegistration();
  const [failure, setFailure] = useState<string | null>(null);
  if (today.isPending) return <Skeleton className="h-32" />;
  if (today.isError || today.data.exemption === 'exempt') return null;
  const { active, pending } = today.data.passkey;

  async function prepare() {
    setFailure(null);
    try {
      await registration.prepare();
    } catch (error) {
      setFailure(punchFailure(t, error));
    }
  }

  async function register() {
    setFailure(null);
    try {
      const passkey = await registration.confirm();
      toast.add({
        title:
          passkey.status === 'pending'
            ? t('hr.attendance.passkey.replacementSent')
            : t('hr.attendance.passkey.registered'),
        type: 'success',
      });
    } catch (error) {
      setFailure(punchFailure(t, error));
    }
  }

  return (
    <Card className="flex flex-col gap-4" data-testid="passkey-card">
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <FingerprintIcon aria-hidden="true" className="size-5 text-muted-foreground" />
        <CardTitle className="me-auto">{t('hr.attendance.passkey.title')}</CardTitle>
        <Badge tone={active ? 'success' : 'warning'}>
          {active ? t('hr.attendance.passkey.active') : t('hr.attendance.passkey.none')}
        </Badge>
        {pending && <Badge tone="info">{t('hr.attendance.passkey.pending')}</Badge>}
      </CardHeader>
      <CardDescription>
        {active ? t('hr.attendance.passkey.activeHint') : t('hr.attendance.passkey.setupHint')}
      </CardDescription>
      {!supportsPasskeys() ? (
        <Callout
          tone="warning"
          icon={<InfoIcon />}
          title={t('hr.attendance.passkey.unsupported')}
        />
      ) : (
        !pending && (
          <div>
            {registration.ready ? (
              // The second tap opens the prompt (Safari opens it only right after a tap).
              <Button disabled={registration.busy} onClick={() => void register()}>
                <FingerprintIcon />
                {t('hr.attendance.passkey.confirm')}
              </Button>
            ) : (
              <Button
                variant={active ? 'outline' : 'primary'}
                disabled={registration.busy}
                onClick={() => void prepare()}
              >
                <FingerprintIcon />
                {active ? t('hr.attendance.passkey.replace') : t('hr.attendance.passkey.register')}
              </Button>
            )}
          </div>
        )
      )}
      {failure && (
        <Callout tone="danger" icon={<TriangleAlertIcon />} title={failure} role="alert" />
      )}
    </Card>
  );
}
