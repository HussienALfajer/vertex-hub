import type { ToOptions } from '@tanstack/react-router';
import type { Notification } from '@vertex-hub/contracts';
import { notificationLink as notificationRoute } from '@vertex-hub/messages';

/*
 * The texts and links of notifications live in `@vertex-hub/messages`, shared with the emails
 * (ADR 0028). This file only hands their links to the router.
 */

export { notificationText } from '@vertex-hub/messages';

/** What a notification opens (F14 rule 15), as router options. */
export function notificationLink(notification: Notification): ToOptions {
  // The route patterns in `@vertex-hub/messages` are the app's own route ids.
  return notificationRoute(notification) as ToOptions;
}
