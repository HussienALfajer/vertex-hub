import { parseAttendanceCode } from '@vertex-hub/contracts';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@vertex-hub/ui';
import { CameraOffIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** The browser's barcode reader, where it has one (Chrome on Android); not in TypeScript's lib. */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike;
  }
}

/** How often a frame is read. */
const SCAN_MS = 200;

/** A reader of video frames: `BarcodeDetector` where available, else jsQR on a canvas. */
async function frameReader(): Promise<(video: HTMLVideoElement) => Promise<string | null>> {
  if (window.BarcodeDetector) {
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    if (!context || video.videoWidth === 0) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return (
      jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })?.data ??
      null
    );
  };
}

/**
 * The scanner (spec screen "My attendance"): the back camera full screen until it reads an
 * entrance code (rule C5), which it hands to `onCode` and closes. Other QR codes are ignored.
 */
export function AttendanceScanner({
  open,
  onClose,
  onCode,
}: {
  open: boolean;
  onClose: () => void;
  onCode: (code: string) => void;
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const handled = useRef(false);

  useEffect(() => {
    if (!open) return;
    handled.current = false;
    setFailed(false);
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const read = await frameReader();
        const tick = async () => {
          if (stopped || !video.current) return;
          const value = await read(video.current).catch(() => null);
          if (value && parseAttendanceCode(value) && !handled.current) {
            handled.current = true;
            onCode(value);
            return;
          }
          timer = window.setTimeout(tick, SCAN_MS);
        };
        await tick();
      } catch {
        if (!stopped) setFailed(true);
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, [open, onCode]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        closeLabel={t('common.close')}
        className="flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-4 rounded-none p-4"
      >
        <DialogTitle>{t('hr.attendance.scanner.title')}</DialogTitle>
        <DialogDescription>{t('hr.attendance.scanner.hint')}</DialogDescription>
        {failed ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <CameraOffIcon aria-hidden="true" className="size-10 text-muted-foreground" />
            <p role="alert">{t('hr.attendance.scanner.noCamera')}</p>
            <Button variant="outline" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        ) : (
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg bg-muted">
            <video
              ref={video}
              playsInline
              muted
              className="size-full object-cover"
              data-testid="scanner-video"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-[15%] rounded-xl border-4 border-primary"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
