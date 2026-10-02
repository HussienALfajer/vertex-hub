import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { FileContentController } from './file-content.controller.js';
import { FileContentService } from './file-content.service.js';
import { FileLibraryService } from './file-library.service.js';
import { FileOwnerRegistry } from './file-owner-registry.js';
import { FileStorage } from './file-storage.js';
import { FileUploadsService } from './file-uploads.service.js';
import { FileVersions } from './file-versions.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { GeneratedFiles } from './generated-files.js';
import { LocalFileStorage } from './local-file-storage.js';

/**
 * Files and versions (F10, ADR 0019). Owns `file_items`, `file_versions` and `file_uploads`;
 * reads users through `auth`'s `UserDirectory` and notifies through `notifications`. Never
 * imports `tasks`, `clients` or `projects`: they register their owner policies in the exported
 * `FileOwnerRegistry`, and `tasks` calls the exported `FileVersions` in its transactions;
 * `quotes` attaches and serves its PDFs through `GeneratedFiles`. Works
 * the `files.preview` and `files.purge-uploads` jobs.
 */
@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [FileContentController, FilesController],
  providers: [
    { provide: FileStorage, useClass: LocalFileStorage },
    FileOwnerRegistry,
    FilesService,
    FileVersions,
    FileLibraryService,
    FileUploadsService,
    FileContentService,
    GeneratedFiles,
  ],
  exports: [FileOwnerRegistry, FileVersions, GeneratedFiles],
})
export class FilesModule {}
