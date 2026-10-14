import type { IncomingMessage, ServerResponse } from 'node:http';
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
  Req,
  Res,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  type ContractAnnex,
  type CreateContract,
  contractAnnexSchema,
  createContractSchema,
  type IssueAnnex,
  issueAnnexSchema,
  type QuotePdfRender,
  quotePdfRenderSchema,
  type RetainerContractDetail,
  type RetainerContractList,
  retainerContractDetailSchema,
  retainerContractListSchema,
  type SignedContract,
  signedContractSchema,
  type UpdateContract,
  updateContractSchema,
  type VoidContract,
  voidContractSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { RetainerContractAnnexesService } from './retainer-contract-annexes.service.js';
import { ContractPdfs } from './retainer-contract-pdfs.js';
import { RetainerContractsService } from './retainer-contracts.service.js';

/**
 * Retainer contracts and annexes (spec F05C K1–K12). Every route also needs money access
 * (`invoices.read` covering the client), and changes client scope; the services check both (403).
 */
@ApiTags('retainers')
@Controller('retainers/:retainerId')
export class RetainerContractsController {
  constructor(
    private readonly contracts: RetainerContractsService,
    private readonly annexes: RetainerContractAnnexesService,
    private readonly pdfs: ContractPdfs,
  ) {}

  @Get('contracts')
  @RequirePermissions('projects.read')
  @SerializeOptions({ schema: retainerContractListSchema })
  @ApiOkResponse({
    description:
      'The retainer’s contracts with their annexes, newest first; discarded drafts left out',
    standardSchema: retainerContractListSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
  ): Promise<RetainerContractList> {
    return this.contracts.list(actor, retainerId);
  }

  @Post('contracts')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: retainerContractDetailSchema })
  @ApiCreatedResponse({
    description: 'A new draft for a term or the open-ended retainer, with the template’s articles',
    standardSchema: retainerContractDetailSchema,
  })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Body({ schema: createContractSchema }) input: CreateContract,
  ): Promise<RetainerContractDetail> {
    return this.contracts.create(actor, retainerId, input);
  }

  @Get('contracts/:contractId')
  @RequirePermissions('projects.read')
  @SerializeOptions({ schema: retainerContractDetailSchema })
  @ApiOkResponse({
    description: 'The contract with what it prints: live for a draft, frozen once issued',
    standardSchema: retainerContractDetailSchema,
  })
  get(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ): Promise<RetainerContractDetail> {
    return this.contracts.get(actor, retainerId, contractId);
  }

  @Patch('contracts/:contractId')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: retainerContractDetailSchema })
  @ApiOkResponse({
    description: 'The draft after the change of its date, signatory or articles',
    standardSchema: retainerContractDetailSchema,
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body({ schema: updateContractSchema }) input: UpdateContract,
  ): Promise<RetainerContractDetail> {
    return this.contracts.update(actor, retainerId, contractId, input);
  }

  @Post('contracts/:contractId/discard')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: retainerContractDetailSchema })
  @ApiOkResponse({
    description: 'The discarded draft',
    standardSchema: retainerContractDetailSchema,
  })
  discard(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ): Promise<RetainerContractDetail> {
    return this.contracts.discard(actor, retainerId, contractId);
  }

  @Post('contracts/:contractId/issue')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: retainerContractDetailSchema })
  @ApiOkResponse({
    description: 'The issued contract, numbered and frozen; its PDF is queued',
    standardSchema: retainerContractDetailSchema,
  })
  issue(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ): Promise<RetainerContractDetail> {
    return this.contracts.issue(actor, retainerId, contractId);
  }

  @Post('contracts/:contractId/void')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: retainerContractDetailSchema })
  @ApiOkResponse({
    description: 'The voided contract',
    standardSchema: retainerContractDetailSchema,
  })
  void(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body({ schema: voidContractSchema }) input: VoidContract,
  ): Promise<RetainerContractDetail> {
    return this.contracts.void(actor, retainerId, contractId, input);
  }

  @Post('contracts/:contractId/signed')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: retainerContractDetailSchema })
  @ApiOkResponse({
    description: 'The signed contract with its signed copy',
    standardSchema: retainerContractDetailSchema,
  })
  signed(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body({ schema: signedContractSchema }) input: SignedContract,
  ): Promise<RetainerContractDetail> {
    return this.contracts.signed(actor, retainerId, contractId, input);
  }

  @Post('contracts/:contractId/pdf')
  @HttpCode(200)
  @RequirePermissions('projects.read')
  @SerializeOptions({ schema: quotePdfRenderSchema })
  @ApiOkResponse({
    description:
      'Queues the draft preview (managers) or renders an issued contract again when its PDF is not ready',
    standardSchema: quotePdfRenderSchema,
  })
  renderPdf(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ): Promise<QuotePdfRender> {
    return this.pdfs.render(actor, retainerId, contractId);
  }

  @Get('contracts/:contractId/pdf')
  @RequirePermissions('projects.read')
  @ApiQuery({ name: 'draft', required: false, enum: ['true'] })
  @ApiOkResponse({ description: 'The PDF of the contract, or the draft preview with draft=true' })
  @ApiNotFoundResponse({ description: 'No such contract, or its PDF is not ready' })
  async downloadPdf(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Query('draft') draft: string | undefined,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    await this.pdfs.serve(actor, retainerId, contractId, draft === 'true', request, response);
  }

  @Post('amendments/:amendmentId/annex')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: contractAnnexSchema })
  @ApiCreatedResponse({
    description: 'The next annex of the contract covering the amendment’s cycle; its PDF is queued',
    standardSchema: contractAnnexSchema,
  })
  issueAnnex(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('amendmentId', ParseUUIDPipe) amendmentId: string,
    @Body({ schema: issueAnnexSchema }) input: IssueAnnex,
  ): Promise<ContractAnnex> {
    return this.annexes.issue(actor, retainerId, amendmentId, input);
  }

  @Post('contracts/:contractId/annexes/:annexId/void')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: contractAnnexSchema })
  @ApiOkResponse({ description: 'The voided annex', standardSchema: contractAnnexSchema })
  voidAnnex(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Param('annexId', ParseUUIDPipe) annexId: string,
    @Body({ schema: voidContractSchema }) input: VoidContract,
  ): Promise<ContractAnnex> {
    return this.annexes.void(actor, retainerId, contractId, annexId, input);
  }

  @Post('contracts/:contractId/annexes/:annexId/signed')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: contractAnnexSchema })
  @ApiOkResponse({
    description: 'The signed annex with its signed copy',
    standardSchema: contractAnnexSchema,
  })
  signedAnnex(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Param('annexId', ParseUUIDPipe) annexId: string,
    @Body({ schema: signedContractSchema }) input: SignedContract,
  ): Promise<ContractAnnex> {
    return this.annexes.signed(actor, retainerId, contractId, annexId, input);
  }

  @Post('contracts/:contractId/annexes/:annexId/pdf')
  @HttpCode(200)
  @RequirePermissions('projects.read')
  @SerializeOptions({ schema: quotePdfRenderSchema })
  @ApiOkResponse({
    description: 'Renders the annex again when its PDF is not ready',
    standardSchema: quotePdfRenderSchema,
  })
  renderAnnexPdf(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Param('annexId', ParseUUIDPipe) annexId: string,
  ): Promise<QuotePdfRender> {
    return this.pdfs.renderAnnex(actor, retainerId, contractId, annexId);
  }

  @Get('contracts/:contractId/annexes/:annexId/pdf')
  @RequirePermissions('projects.read')
  @ApiOkResponse({ description: 'The PDF of the annex' })
  @ApiNotFoundResponse({ description: 'No such annex, or its PDF is not ready' })
  async downloadAnnexPdf(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Param('annexId', ParseUUIDPipe) annexId: string,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    await this.pdfs.serveAnnex(actor, retainerId, contractId, annexId, request, response);
  }
}
