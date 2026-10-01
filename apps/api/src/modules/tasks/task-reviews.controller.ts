import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  SerializeOptions,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type MedicalReview,
  medicalReviewSchema,
  type TaskClientTextInput,
  type TaskDetail,
  taskClientTextInputSchema,
  taskDetailSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { TaskReviewsService } from './task-reviews.service.js';

@ApiTags('tasks')
@Controller('tasks/:id')
export class TaskReviewsController {
  constructor(private readonly reviews: TaskReviewsService) {}

  @Post('medical-review')
  @HttpCode(200)
  @RequirePermissions('approvals.review_medical')
  @SerializeOptions({ schema: taskDetailSchema })
  @ApiOkResponse({
    description:
      'The task after the medical review: sent to the client, or returned with notes; never by its assignee',
    standardSchema: taskDetailSchema,
  })
  medicalReview(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: medicalReviewSchema }) input: MedicalReview,
  ): Promise<TaskDetail> {
    return this.reviews.medicalReview(actor, id, input);
  }

  @Put('client-text')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskDetailSchema })
  @ApiOkResponse({
    description:
      'The task with its text for the client (task workers and manage scope); a blank text clears it',
    standardSchema: taskDetailSchema,
  })
  setClientText(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: taskClientTextInputSchema }) input: TaskClientTextInput,
  ): Promise<TaskDetail> {
    return this.reviews.setClientText(actor, id, input);
  }
}
