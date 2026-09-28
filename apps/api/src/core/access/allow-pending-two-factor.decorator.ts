import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_TWO_FACTOR = Symbol('ALLOW_PENDING_TWO_FACTOR');

/**
 * Lets a signed-in user who must set up two-factor sign-in, and has not yet, call this route.
 * Every other route answers `TWO_FACTOR_REQUIRED` for them until they enable it (F01 rule 15).
 */
export const AllowPendingTwoFactor = () => SetMetadata(ALLOW_PENDING_TWO_FACTOR, true);
