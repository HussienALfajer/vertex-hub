import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CreateUser,
  createUserSchema,
  type SkillListResponse,
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
import { RequirePermissions } from '../../core/access/index.js';
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
