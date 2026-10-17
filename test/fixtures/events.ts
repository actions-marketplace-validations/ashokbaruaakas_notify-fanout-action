import type { Env } from '../../src/context/variables.js';

export interface EventFixture {
  env: Env;
  payload: unknown;
}

const base: Env = {
  GITHUB_REPOSITORY: 'octo/app',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_RUN_ID: '9001',
  GITHUB_RUN_NUMBER: '42',
  GITHUB_WORKFLOW: 'CI',
  GITHUB_JOB: 'build',
  GITHUB_ACTOR: 'octocat',
  GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REF_NAME: 'main',
};

export const events = {
  push: {
    env: { ...base, GITHUB_EVENT_NAME: 'push' },
    payload: { head_commit: { message: 'Fix <login> & **retry** logic\n\nLonger description.' } },
  },
  pull_request: {
    env: {
      ...base,
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_REF: 'refs/pull/7/merge',
      GITHUB_REF_NAME: '7/merge',
      GITHUB_HEAD_REF: 'feature/snake_case',
      GITHUB_SHA: 'ffffffffffffffffffffffffffffffffffffffff',
    },
    payload: {
      pull_request: {
        number: 7,
        title: 'Add <b>bold</b> & [links](x) support',
        html_url: 'https://github.com/octo/app/pull/7',
        head: { sha: 'abcdef1234567890abcdef1234567890abcdef12' },
      },
    },
  },
  issues: {
    env: { ...base, GITHUB_EVENT_NAME: 'issues' },
    payload: {
      issue: {
        number: 12,
        title: 'Crash when `x` < 0',
        html_url: 'https://github.com/octo/app/issues/12',
      },
    },
  },
  release: {
    env: {
      ...base,
      GITHUB_EVENT_NAME: 'release',
      GITHUB_REF: 'refs/tags/v1.2.0',
      GITHUB_REF_NAME: 'v1.2.0',
    },
    payload: {
      release: { tag_name: 'v1.2.0', html_url: 'https://github.com/octo/app/releases/tag/v1.2.0' },
    },
  },
  deployment_status: {
    env: { ...base, GITHUB_EVENT_NAME: 'deployment_status' },
    payload: { deployment: { environment: 'production' } },
  },
  workflow_dispatch: {
    env: { ...base, GITHUB_EVENT_NAME: 'workflow_dispatch' },
    payload: {},
  },
} satisfies Record<string, EventFixture>;
