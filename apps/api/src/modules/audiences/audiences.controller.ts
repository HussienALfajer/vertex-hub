import { Body, Controller, HttpCode, Post, SerializeOptions } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type Audience,
  type AudiencePreview,
  audiencePreviewSchema,
  audienceSchema,
} from '@vertex-hub/contracts';
import { RequireSession } from '../../core/access/index.js';
import { AudiencesService } from './audiences.service.js';

/** F16 rule D2: what the audience picker shows before sending. */
@ApiTags('audiences')
@ApiUnauthorizedResponse({ description: 'No valid session' })
@Controller('audiences')
export class AudiencesController {
  constructor(private readonly audiences: AudiencesService) {}

  @Post('preview')
  @HttpCode(200)
  @RequireSession()
  @SerializeOptions({ schema: audiencePreviewSchema })
  @ApiOkResponse({
    description: 'How many active users the audience reaches, and their names (up to 500)',
    standardSchema: audiencePreviewSchema,
  })
  @ApiBadRequestResponse({ description: 'The audience has no source, or a list is too long' })
  preview(@Body({ schema: audienceSchema }) audience: Audience): Promise<AudiencePreview> {
    return this.audiences.preview(audience);
  }
}
