import type { CiContext } from "./types.js";

/**
 * Detects CI provider context (project, pipeline, commit, branch) from common
 * env vars. Order: GitLab → GitHub Actions → TeamCity → AppVeyor → fallback.
 *
 * Each field is read from whichever provider's vars are present; we don't
 * require all fields to come from the same provider, which makes it easy to
 * override individual values via the environment without breaking detection.
 */
export function detectCiContext(env: NodeJS.ProcessEnv = process.env): CiContext {
  return {
    project: detectProject(env),
    pipeline_id: detectPipelineId(env),
    commit_sha: detectCommitSha(env),
    branch: detectBranch(env),
  };
}

function detectProject(env: NodeJS.ProcessEnv): string {
  return (
    env.CI_PROJECT_PATH ??
    env.GITHUB_REPOSITORY ??
    env.TEAMCITY_BUILDCONF_NAME ??
    env.APPVEYOR_PROJECT_SLUG ??
    "unknown"
  );
}

function detectPipelineId(env: NodeJS.ProcessEnv): string {
  return (
    env.CI_PIPELINE_ID ??
    env.GITHUB_RUN_ID ??
    env.BUILD_NUMBER ??
    env.APPVEYOR_BUILD_ID ??
    "local"
  );
}

function detectCommitSha(env: NodeJS.ProcessEnv): string {
  return (
    env.CI_COMMIT_SHA ??
    env.GITHUB_SHA ??
    env.BUILD_VCS_NUMBER ??
    env.APPVEYOR_REPO_COMMIT ??
    "unknown"
  );
}

function detectBranch(env: NodeJS.ProcessEnv): string {
  return (
    env.CI_COMMIT_BRANCH ??
    env.GITHUB_REF_NAME ??
    env.TEAMCITY_BUILD_BRANCH ??
    env.APPVEYOR_REPO_BRANCH ??
    "unknown"
  );
}
