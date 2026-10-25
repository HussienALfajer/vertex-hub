import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  type CreateUser,
  createUserSchema,
  type Image,
  imageSchema,
  type SetImage,
  type SkillListResponse,
  setImageSchema,
  skillListResponseSchema,
  type UpdateUser,
  type UserLink,
  type UserListQuery,
  type UserPage,
  type UserResponse,
  type UserWithLinkResponse,
  updateUserSchema,
  userLinkSchema,
  userListQuerySchema,
  userPageSchema,
  userResponseSchema,
  userWithLinkResponseSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions, RequireSession } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from './current-user.decorator.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users.read')
  @SerializeOptions({ schema: userPageSchema })
  @ApiOkResponse({ description: 'The team directory', standardSchema: userPageSchema })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: userListQuerySchema }) query: UserListQuery,
  ): Promise<UserPage> {
    return this.users.list(actor, query);
  }

  @Get('skills')
  @RequirePermissions('users.read')
  @SerializeOptions({ schema: skillListResponseSchema })
  @ApiOkResponse({ description: 'Skills in use', standardSchema: skillListResponseSchema })
  skills(): Promise<SkillListResponse> {
    return this.users.skills();
  }

  @Get(':id')
  @RequirePermissions('users.read')
  @SerializeOptions({ schema: userResponseSchema })
  @ApiOkResponse({ description: 'A user', standardSchema: userResponseSchema })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserResponse> {
    return this.users.detail(actor, id);
  }

  @Post()
  @RequirePermissions('users.manage')
  @SerializeOptions({ schema: userWithLinkResponseSchema })
  @ApiCreatedResponse({
    description: 'The new user, invited, with their activation link',
    standardSchema: userWithLinkResponseSchema,
  })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createUserSchema }) input: CreateUser,
  ): Promise<UserWithLinkResponse> {
    return this.users.create(actor, input);
  }

  @Patch(':id')
  @RequirePermissions('users.manage')
  @SerializeOptions({ schema: userResponseSchema })
  @ApiOkResponse({ description: 'The updated user', standardSchema: userResponseSchema })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateUserSchema }) input: UpdateUser,
  ): Promise<UserResponse> {
    return this.users.update(actor, id, input);
  }

  @Post(':id/link')
  @HttpCode(200)
  @RequirePermissions('users.manage')
  @SerializeOptions({ schema: userLinkSchema })
  @ApiOkResponse({
    description: 'A new activation or password reset link; earlier links stop working',
    standardSchema: userLinkSchema,
  })
  issueLink(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserLink> {
    return this.users.issueUserLink(actor, id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('users.manage')
  @SerializeOptions({ schema: userResponseSchema })
  @ApiOkResponse({ description: 'The archived user', standardSchema: userResponseSchema })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserResponse> {
    return this.users.archive(actor, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('users.manage')
  @SerializeOptions({ schema: userWithLinkResponseSchema })
  @ApiOkResponse({
    description: 'The restored user, invited again, with a new activation link',
    standardSchema: userWithLinkResponseSchema,
  })
  restore(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserWithLinkResponse> {
    return this.users.restore(actor, id);
  }

  @Put(':id/image')
  @RequireSession()
  @SerializeOptions({ schema: imageSchema })
  @ApiOkResponse({
    description: 'The new photo, pending until rendered',
    standardSchema: imageSchema,
  })
  @ApiBadRequestResponse({
    description:
      '`UPLOAD_NOT_FOUND`, `IMAGE_TYPE_NOT_ALLOWED`, `IMAGE_TOO_SMALL`, `BRAND_FILE_NOT_FOUND` (users take no brand file)',
  })
  @ApiPayloadTooLargeResponse({ description: '`IMAGE_TOO_LARGE`: above 10 MB' })
  @ApiForbiddenResponse({
    description: "Another user's photo without `users.manage`; `GENERAL_MANAGER_ONLY`",
  })
  @ApiNotFoundResponse({ description: 'No such user' })
  @ApiConflictResponse({ description: '`USER_ARCHIVED`' })
  setImage(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: setImageSchema }) input: SetImage,
  ): Promise<Image> {
    return this.users.setImage(actor, id, input);
  }

  @Delete(':id/image')
  @HttpCode(204)
  @RequireSession()
  @ApiNoContentResponse({ description: 'The photo is removed (also when there was none)' })
  @ApiForbiddenResponse({
    description: "Another user's photo without `users.manage`; `GENERAL_MANAGER_ONLY`",
  })
  @ApiNotFoundResponse({ description: 'No such user' })
  @ApiConflictResponse({ description: '`USER_ARCHIVED`' })
  removeImage(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.users.removeImage(actor, id);
  }

  @Post(':id/two-factor/reset')
  @HttpCode(200)
  @RequirePermissions('users.manage')
  @SerializeOptions({ schema: userResponseSchema })
  @ApiOkResponse({
    description: 'The user with two-factor sign-in turned off',
    standardSchema: userResponseSchema,
  })
  resetTwoFactor(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserResponse> {
    return this.users.resetTwoFactor(actor, id);
  }
}
