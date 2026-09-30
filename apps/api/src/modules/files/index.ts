// Public surface of the files module. Code outside this folder imports from here only.
export {
  type ClientOwner,
  type FileOwner,
  type FileOwnerPolicy,
  FileOwnerRegistry,
  type FileOwnerRights,
  isConfidentialReader,
} from './file-owner-registry.js';
export { FileVersions } from './file-versions.js';
export { FilesModule } from './files.module.js';
