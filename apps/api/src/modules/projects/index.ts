// Public surface of the projects module. Code outside this folder imports from here only.
export {
  type CycleLineLink,
  type CycleLink,
  EngagementDirectory,
  type ExtraWorkLink,
  type MilestoneLink,
  type ProjectLink,
} from './engagement-directory.js';
export { ProjectsModule } from './projects.module.js';
export { WorkProgress, type WorkProgressSource } from './work-progress.js';
