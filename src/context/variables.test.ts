import { describe, expect, it } from 'vitest';

import { events } from '../../test/fixtures/events.js';
import { buildVariables, CONTEXT_VARIABLES, loadEventPayload } from './variables.js';

describe('buildVariables', () => {
  it('maps a push', () => {
    const vars = buildVariables(events.push.env, events.push.payload);
    expect(Object.fromEntries(vars)).toMatchObject({
      REPOSITORY: 'octo/app',
      BRANCH: 'main',
      WORKFLOW: 'CI',
      JOB: 'build',
      EVENT: 'push',
      COMMIT: '0123456789abcdef0123456789abcdef01234567',
      COMMIT_SHORT: '0123456',
      COMMIT_MESSAGE: 'Fix <login> & **retry** logic',
      AUTHOR: 'octocat',
      RUN_URL: 'https://github.com/octo/app/actions/runs/9001',
      RUN_NUMBER: '42',
      SERVER_URL: 'https://github.com',
      PR_NUMBER: '',
      TAG: '',
    });
  });

  it('uses the PR head branch and head commit on pull requests', () => {
    const vars = buildVariables(events.pull_request.env, events.pull_request.payload);
    expect(vars.get('BRANCH')).toBe('feature/snake_case');
    expect(vars.get('COMMIT_SHORT')).toBe('abcdef1');
    expect(vars.get('PR_NUMBER')).toBe('7');
    expect(vars.get('PR_URL')).toBe('https://github.com/octo/app/pull/7');
  });

  it('maps releases, issues and deployments', () => {
    const release = buildVariables(events.release.env, events.release.payload);
    expect(release.get('TAG')).toBe('v1.2.0');
    expect(release.get('BRANCH')).toBe('');
    expect(release.get('RELEASE_URL')).toContain('/releases/tag/v1.2.0');
    expect(buildVariables(events.issues.env, events.issues.payload).get('ISSUE_TITLE')).toBe(
      'Crash when `x` < 0',
    );
    expect(
      buildVariables(events.deployment_status.env, events.deployment_status.payload).get(
        'ENVIRONMENT',
      ),
    ).toBe('production');
  });

  it('defines every variable, even with no context at all', () => {
    const vars = buildVariables({}, null);
    expect([...vars.keys()].sort()).toEqual([...CONTEXT_VARIABLES].sort());
    expect(vars.get('RUN_URL')).toBe('');
    expect(vars.get('SERVER_URL')).toBe('https://github.com');
  });

  it('ignores payload values of the wrong type', () => {
    const vars = buildVariables(
      {},
      { pull_request: { number: { evil: true }, title: ['x'] }, issue: 'nope' },
    );
    expect(vars.get('PR_NUMBER')).toBe('');
    expect(vars.get('PR_TITLE')).toBe('');
    expect(vars.get('ISSUE_NUMBER')).toBe('');
  });
});

describe('loadEventPayload', () => {
  it('reads GITHUB_EVENT_PATH and falls back to {}', async () => {
    const read = (path: string) =>
      path === '/event.json' ? Promise.resolve('{"a":1}') : Promise.reject(new Error('missing'));
    await expect(loadEventPayload({ GITHUB_EVENT_PATH: '/event.json' }, read)).resolves.toEqual({
      a: 1,
    });
    await expect(loadEventPayload({ GITHUB_EVENT_PATH: '/other.json' }, read)).resolves.toEqual({});
    await expect(loadEventPayload({}, read)).resolves.toEqual({});
  });
});
