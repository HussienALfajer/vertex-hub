import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { parseAttendanceCode } from '@vertex-hub/contracts';
import { Button, Callout, Card, CardDescription, CardTitle, PageHeader } from '@vertex-hub/ui';
import { CameraIcon, LogInIcon, LogOutIcon, TriangleAlertIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AttendanceScanner } from './attendance-scanner';
import { GreetingDialog, PunchConfirmDialog, usePunchWithGreeting } from './attendance-today';
import { myAttendanceTodayQuery } from './hr.queries';

/**
 * `/attend#<code>` (rule C5): the page a phone's camera opens from the entrance code. The passkey
 * prompt needs a tap, so the punch waits for "Confirm"; an expired code offers the scanner.
 */
export function AttendPage() {
  // A new code opened in the same tab changes only the hash: the page starts over with it.
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const changed = () => setHash(window.location.hash);
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  return <Attend key={hash} hash={hash} />;
}

function Attend({ hash }: { hash: string }) {
  const { t } = useTranslation();
  const [code, setCode] = useState(() => (parseAttendanceCode(hash) ? hash.slice(1) : null));
  const today = useQuery(myAttendanceTodayQuery);
  const punch = usePunchWithGreeting();
  const [scanning, setScanning] = useState(false);
  const [done, setDone] = useState(false);
  const closeGreeting = useCallback(() => {
    punch.setGreeting(null);
    setDone(true);
  }, [punch.setGreeting]);
  const onCode = useCallback((next: string) => {
    setScanning(false);
    setCode(next);
  }, []);
  const out = today.data?.nextDirection === 'out';

  return (
    <>
      <PageHeader title={t('hr.attendance.attend.title')} />
      <Card className="mx-auto w-full max-w-md items-stretch">
        <CardTitle>
          {out ? t('hr.attendance.attend.confirmOut') : t('hr.attendance.attend.confirmIn')}
        </CardTitle>
        <CardDescription>
          {code ? t('hr.attendance.attend.hint') : t('hr.attendance.attend.noCode')}
        </CardDescription>
        {code && !done ? (
          <Button
            size="lg"
            disabled={punch.busy}
            onClick={() => void punch.run({ method: 'office', code })}
          >
            {out ? <LogOutIcon /> : <LogInIcon />}
            {punch.busy
              ? t(`hr.attendance.steps.${punch.step}`)
              : t('hr.attendance.attend.confirm')}
          </Button>
        ) : (
          !done && (
            <Button size="lg" onClick={() => setScanning(true)}>
              <CameraIcon />
              {t('hr.attendance.actions.scanIn')}
            </Button>
          )
        )}
        {punch.failure && (
          <>
            <Callout
              tone="danger"
              icon={<TriangleAlertIcon />}
              title={punch.failure}
              role="alert"
            />
            <Button variant="outline" onClick={() => setScanning(true)}>
              <CameraIcon />
              {t('hr.attendance.attend.scanAgain')}
            </Button>
          </>
        )}
        <Link to="/me/attendance" className="text-sm font-medium hover:underline">
          {t('hr.attendance.attend.myAttendance')}
        </Link>
      </Card>
      <AttendanceScanner open={scanning} onClose={() => setScanning(false)} onCode={onCode} />
      <PunchConfirmDialog punch={punch} direction={out ? 'out' : 'in'} />
      <GreetingDialog greeting={punch.greeting} onClose={closeGreeting} />
    </>
  );
}
