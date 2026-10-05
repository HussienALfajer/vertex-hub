// Public surface of the auth module. Code outside this folder imports from here only.
export { AuthModule } from './auth.module.js';
export { createUser, type NewUser } from './create-user.js';
export { CurrentUser, type CurrentUserInfo } from './current-user.decorator.js';
export { resetTwoFactor, userIdByEmail } from './reset-two-factor.js';
export { type ResponsibilityCheck, ResponsibilityRegistry } from './responsibility-registry.js';
export {
  type Mailbox,
  type Signature,
  UserDirectory,
  type UserSummary,
} from './user-directory.js';
export { lockAccessChanges } from './user-status.js';
