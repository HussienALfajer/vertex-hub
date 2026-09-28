import { Controller, Get, SerializeOptions, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { type HealthResponse, healthResponseSchema } from '@vertex-hub/contracts';
import { HealthService } from './health.service.js';

@ApiTags('system')
@AllowAnonymous()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @SerializeOptions({ schema: healthResponseSchema })
  @ApiOkResponse({
    description: 'The API and all its dependencies are up',
    standardSchema: healthResponseSchema,
  })
  @ApiServiceUnavailableResponse({
    description: 'A dependency is down',
    standardSchema: healthResponseSchema,
  })
  async check(): Promise<HealthResponse> {
    const result = await this.health.check();
    if (result.status !== 'ok') throw new ServiceUnavailableException(result);
    return result;
  }
}
