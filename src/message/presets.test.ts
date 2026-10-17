import { describe, expect, it } from 'vitest';

import { resolveStatus } from './model.js';
import { presetContent, resolvePreset } from './presets.js';

describe('resolvePreset', () => {
  it.each([
    ['push', 'push'],
    ['pull_request', 'pull_request'],
    ['pull_request_target', 'pull_request'],
    ['issues', 'issue'],
    ['issue_comment', 'issue'],
    ['release', 'release'],
    ['deployment_status', 'deployment'],
    ['workflow_dispatch', 'workflow'],
    ['schedule', 'workflow'],
    ['', 'workflow'],
    ['constructor', 'workflow'],
  ])('auto maps event %j to %j', (event, preset) => {
    expect(resolvePreset('auto', event)).toBe(preset);
  });

  it('keeps an explicit preset', () => {
    expect(resolvePreset('release', 'push')).toBe('release');
  });
});

describe('presetContent', () => {
  it.each([
    ['success', '{{EMOJI}} {{WORKFLOW}} succeeded'],
    ['failure', '{{EMOJI}} {{WORKFLOW}} failed'],
    ['cancelled', '{{EMOJI}} {{WORKFLOW}} was cancelled'],
    ['warning', '{{EMOJI}} {{WORKFLOW}} finished with warnings'],
    ['started', '{{EMOJI}} {{WORKFLOW}} started'],
    ['info', '{{EMOJI}} {{WORKFLOW}}'],
    ['Deployed', '{{EMOJI}} {{WORKFLOW}} Deployed'],
  ])('words the workflow title for status %j', (status, title) => {
    expect(presetContent('workflow', resolveStatus(status)).title).toBe(title);
  });

  it('says a successful release was published', () => {
    expect(presetContent('release', resolveStatus('success')).title).toBe(
      '{{EMOJI}} Release {{TAG}} published',
    );
  });

  it('gives custom no content', () => {
    expect(presetContent('custom', resolveStatus('success'))).toEqual({
      title: '',
      body: '',
      fields: [],
      links: [],
    });
  });
});
