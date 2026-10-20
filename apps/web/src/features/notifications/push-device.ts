import type { PushSubscriptionInput } from '@vertex-hub/contracts';
import { currentApplePlatform, isStandalone } from '../app/install';

/*
 * F16 rule A7: push on this device. The browser holds the permission and the subscription; the
 * API keeps the subscription on the current session (`PUT /api/me/push/subscription`).
 */

/**
 * - `unsupported`: the browser has no Web Push.
 * - `install`: an iPhone browser tab; push needs the app on the home screen (edge case 2).
 * - `too-old`: iOS before 16.4.
 * - `blocked`: the user refused the permission; only the browser's settings can change it.
 * - `off` / `on`: whether this device has a subscription.
 */
export type PushDeviceState = 'unsupported' | 'install' | 'too-old' | 'blocked' | 'off' | 'on';

const OFF_KEY = 'vertex-push-off';

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function readPushDevice(): Promise<PushDeviceState> {
  const apple = currentApplePlatform();
  if (apple.apple && !apple.pushCapable) return 'too-old';
  if (!supported()) return apple.apple && !isStandalone() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  return (await currentSubscription()) ? 'on' : 'off';
}

/** The VAPID public key (base64url) as the push manager takes it. */
export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const bytes = atob(padded);
  const key = new Uint8Array(new ArrayBuffer(bytes.length));
  for (let index = 0; index < bytes.length; index += 1) key[index] = bytes.charCodeAt(index);
  return key;
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}

/** The browser's subscription as the API stores it. */
function subscriptionInput(subscription: PushSubscription): PushSubscriptionInput {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
  };
}

/** This device's subscription for the server's key: the existing one, or a new one. */
async function subscribe(vapidPublicKey: string): Promise<PushSubscriptionInput> {
  const registration = await navigator.serviceWorker.ready;
  const key = applicationServerKey(vapidPublicKey);
  const existing = await registration.pushManager.getSubscription();
  // A subscription made for another key (the server's keys changed) cannot receive.
  if (existing && sameKey(existing, key)) return subscriptionInput(existing);
  await existing?.unsubscribe();
  const created = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  return subscriptionInput(created);
}

/**
 * The user's gesture "Turn on notifications on this device": asks the permission, then
 * subscribes. Resolves to the subscription to store, or to the state when it was refused.
 */
export async function turnOnPush(
  vapidPublicKey: string,
): Promise<PushSubscriptionInput | 'blocked' | 'off'> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const input = await subscribe(vapidPublicKey);
  setTurnedOff(false);
  return input;
}

/** "Turn off on this device": the browser forgets the subscription; the caller tells the API. */
export async function turnOffPush(): Promise<void> {
  await (await currentSubscription())?.unsubscribe();
  setTurnedOff(true);
}

/**
 * Edge case 3: after a sign-in, the browser still holds the permission, so the device subscribes
 * again without asking, unless the user turned push off here. Resolves to the subscription to
 * store on the new session, or null.
 */
export async function resumePush(vapidPublicKey: string): Promise<PushSubscriptionInput | null> {
  if (!supported() || Notification.permission !== 'granted' || turnedOff()) return null;
  return subscribe(vapidPublicKey);
}

/** The user turned push off on this device (it stays off across sign-ins). */
export function turnedOff(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) === '1';
  } catch {
    return false;
  }
}

function setTurnedOff(off: boolean) {
  try {
    if (off) localStorage.setItem(OFF_KEY, '1');
    else localStorage.removeItem(OFF_KEY);
  } catch {
    // Storage blocked: the device may subscribe again at the next sign-in.
  }
}
