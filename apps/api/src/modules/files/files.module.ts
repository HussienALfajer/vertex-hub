import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { FileAttachments } from './file-attachments.js';
import { FileContentController } from './file-content.controller.js';
import { FileContentService } from './file-content.service.js';
import { FileLibraryService } from './file-library.service.js';
import { FileOwnerRegistry } from './file-owner-registry.js';
import { FilePurges } from './file-purges.js';
import { FileStorage } from './file-storage.js';
import { FileUploadsService } from './file-uploads.service.js';
import { FileVersions } from './file-versions.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { GeneratedFiles } from './generated-files.js';
import { ImagesController } from './images.controller.js';
import { ImagesService } from './images.service.js';
import { LocalFileStorage } from './local-file-storage.js';

/**
 * Files and versions (F10, ADR 0019) and profile images (F01C, ADR 0040). Owns `file_items`,
 * `file_versions`, `file_uploads` and `images` (stored for `auth` through its `UserImages`);
 * reads users through `auth`'s `UserDirectory` and notifies through `notifications`. Never
 * imports `tasks`, `clients` or `projects`: they register their owner policies in the exported
 * `FileOwnerRegistry`, and `tasks` calls the exported `FileVersions` and `FileAttachments` (its
 * thread's attachments, F06B) in its transactions;
 * `quotes` and `invoices` attach and serve their documents through `GeneratedFiles`. Works
 * the `files.preview` and `files.purge-uploads` jobs; the purge also runs the `FilePurges` other
 * modules register (`invoices`' statement PDFs).
 */
@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [FileContentController, FilesController, ImagesController],
  providers: [
    { provide: FileStorage, useClass: LocalFileStorage },
    FileAttachments,
    FileOwnerRegistry,
    FilePurges,
    FilesService,
    FileVersions,
    FileLibraryService,
    FileUploadsService,
    FileContentService,
    GeneratedFiles,
    ImagesService,
  ],
  exports: [FileAttachments, FileOwnerRegistry, FilePurges, FileVersions, GeneratedFiles, ImagesService],
})
export class FilesModule {}
