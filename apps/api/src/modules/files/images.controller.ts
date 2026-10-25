import type { IncomingMessage, ServerResponse } from 'node:http';
import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { imageSizeSchema } from '@vertex-hub/contracts';
import { RequireSession } from '../../core/access/index.js';
import { FileContentService } from './file-content.service.js';

/** Profile images by id, to signed-in users only (spec F01C rule 11). */
@ApiTags('files')
@RequireSession()
@ApiUnauthorizedResponse({ description: 'No valid session' })
@Controller('images')
export class ImagesController {
  constructor(private readonly content: FileContentService) {}

  @Get(':id/:size')
  @ApiOkResponse({
    description:
      'The rendition (WebP, cached for good), or the uploaded square while it renders (never cached)',
  })
  @ApiNotFoundResponse({
    description: 'No such current image or size, or the image could not be rendered',
  })
  async image(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('size') size: string,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    // Only `sm` and `md` exist: any other size is an unknown resource.
    const parsed = imageSizeSchema.safeParse(size);
    if (!parsed.success) throw new NotFoundException();
    await this.content.image(id, parsed.data, request, response);
  }
}
