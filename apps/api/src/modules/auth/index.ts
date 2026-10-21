// Public surface of the auth module. Code outside this folder imports from here only.
export { AccountArchiver } from './account-archiver.js';
export {
  type AccountNotice,
  type AccountNoticeSink,
  AccountNotices,
} from './account-notices.js';
export { AuthModule } from './auth.module.js';
export { createUser, type NewUser } from './create-user.js';
export { CurrentUser, type CurrentUserInfo } from './current-user.decorator.js';
export { deviceCookie } from './device-cookie.js';
export { type DevicePushLookup, DevicePushStates } from './device-push-states.js';
export { resetTwoFactor, userIdByEmail } from './reset-two-factor.js';
export {
  type OpenWorkCount,
  type ResponsibilityCheck,
  ResponsibilityRegistry,
} from './responsibility-registry.js';
export {
  type Mailbox,
  type PeopleSources,
  type ProfileFilter,
  type Signature,
  UserDirectory,
  type UserProfile,
  type UserSummary,
} from './user-directory.js';
export { UserLifecycle, type UserLifecycleHook } from './user-lifecycle.js';
export { lockAccessChanges } from './user-status.js';
