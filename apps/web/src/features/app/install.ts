import { useSyncExternalStore } from 'react';

/*
 * F16 rule A3: installing the app. Android and computers offer it through the browser's prompt,
 * caught here at start and replayed by the app's own button; iPhone and iPad have no prompt, so
 * the app shows its install guide instead.
 */

/** Chrome's install offer (not in the DOM types). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState {
  offer: BeforeInstallPromptEvent | null;
  installed: boolean;
}

let state: InstallState = { offer: null, installed: false };
const listeners = new Set<() => void>();

function update(next: Partial<InstallState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

/** Called once at start: the browser fires its offer early, before any page renders. */
export function catchInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    update({ offer: event as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => update({ offer: null, installed: true }));
}

/** The app runs from its icon, not in a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export interface ApplePlatform {
  /** iPhone, iPad or iPod, including iPads that present themselves as a Mac. */
  apple: boolean;
  /** iOS 16.4 or later: notifications work once the app is on the home screen. */
  pushCapable: boolean;
}

/** Reads the iOS version from Safari's user agent (`Version/17.2`, else `OS 17_2`). */
export function applePlatform(userAgent: string, maxTouchPoints: number): ApplePlatform {
  const apple =
    /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (!apple) return { apple: false, pushCapable: false };
  const match = /Version\/(\d+)\.(\d+)/.exec(userAgent) ?? /OS (\d+)_(\d+)/.exec(userAgent);
  const major = Number(match?.[1] ?? 0);
  const minor = Number(match?.[2] ?? 0);
  return { apple, pushCapable: major > 16 || (major === 16 && minor >= 4) };
}

export function currentApplePlatform(): ApplePlatform {
  return applePlatform(navigator.userAgent, navigator.maxTouchPoints);
}

/**
 * How this device installs the app: the browser's prompt, the iPhone guide, nothing (installed,
 * or a browser without an offer).
 */
export type InstallOffer = 'prompt' | 'guide' | 'none';

function snapshot(): InstallState {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInstallOffer(): { offer: InstallOffer; install: () => Promise<void> } {
  const current = useSyncExternalStore(subscribe, snapshot);
  const offer: InstallOffer =
    current.installed || isStandalone()
      ? 'none'
      : current.offer
        ? 'prompt'
        : currentApplePlatform().apple
          ? 'guide'
          : 'none';
  async function install() {
    const event = current.offer;
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    // The browser's offer is used once; a refusal waits for the browser to offer again.
    update({ offer: null, installed: outcome === 'accepted' });
  }
  return { offer, install };
}

const DISMISSED_KEY = 'vertex-install-dismissed';
const DISMISS_DAYS = 30;

/** Rule A3: "Not now" hides the home card on this device for 30 days. */
export function installCardDismissed(now = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY));
    return at > 0 && now - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function dismissInstallCard(now = Date.now()): void {
  try {
    localStorage.setItem(DISMISSED_KEY, String(now));
  } catch {
    // Storage blocked: the card shows again next time.
  }
}
