// Public surface of the files module. Code outside this folder imports from here only.

export { contentDisposition, type PreviewSize } from './file-content.service.js';
export {
  type ClientOwner,
  type FileOwner,
  type FileOwnerPolicy,
  FileOwnerRegistry,
  type FileOwnerRights,
  isConfidentialReader,
} from './file-owner-registry.js';
export { type FilePurge, FilePurges } from './file-purges.js';
export { FileVersions, type SentVersion, type VersionRef } from './file-versions.js';
export { FilesModule } from './files.module.js';
export {
  type AttachedUpload,
  type GeneratedDocument,
  GeneratedFiles,
  type StoredObject,
} from './generated-files.js';
