import type { Field, Link, ResolvedStatus } from './model.js';

export const PRESETS = [
  'auto',
  'workflow',
  'deployment',
  'release',
  'pull_request',
  'issue',
  'push',
  'custom',
] as const;
export type PresetName = (typeof PRESETS)[number];
export type ConcretePreset = Exclude<PresetName, 'auto'>;

/** Preset content. Every string is a template; values are filled in by `composeMessage`. */
export interface ContentTemplate {
  title: string;
  body: string;
  fields: Field[];
  links: Link[];
}

const EVENT_PRESETS: Record<string, ConcretePreset> = {
  push: 'push',
  pull_request: 'pull_request',
  pull_request_target: 'pull_request',
  pull_request_review: 'pull_request',
  pull_request_review_comment: 'pull_request',
  issues: 'issue',
  issue_comment: 'issue',
  release: 'release',
  deployment: 'deployment',
  deployment_status: 'deployment',
};

export function resolvePreset(preset: PresetName, eventName: string): ConcretePreset {
  if (preset !== 'auto') return preset;
  return Object.hasOwn(EVENT_PRESETS, eventName)
    ? (EVENT_PRESETS[eventName] ?? 'workflow')
    : 'workflow';
}

function outcome(status: ResolvedStatus): string {
  if (!status.known) return status.label;
  switch (status.status) {
    case 'success':
      return 'succeeded';
    case 'failure':
      return 'failed';
    case 'cancelled':
      return 'was cancelled';
    case 'warning':
      return 'finished with warnings';
    case 'started':
      return 'started';
    case 'info':
      return '';
  }
}

function heading(...parts: string[]): string {
  return ['{{EMOJI}}', ...parts].filter((part) => part !== '').join(' ');
}

const field = (name: string, value: string, short = true): Field => ({ name, value, short });

const REPOSITORY = field('Repository', '{{REPOSITORY}}');
const BRANCH = field('Branch', '{{BRANCH}}');
const COMMIT = field('Commit', '{{COMMIT_SHORT}} {{COMMIT_MESSAGE}}', false);
const ACTOR = field('Triggered by', '{{AUTHOR}}');
const RUN = field('Run', '{{RUN_NUMBER}}');
const RUN_LINK: Link = { label: 'View run', url: '{{RUN_URL}}' };

export function presetContent(preset: ConcretePreset, status: ResolvedStatus): ContentTemplate {
  const verb = outcome(status);
  switch (preset) {
    case 'workflow':
      return {
        title: heading('{{WORKFLOW}}', verb),
        body: '',
        fields: [REPOSITORY, BRANCH, COMMIT, ACTOR, RUN],
        links: [RUN_LINK],
      };
    case 'push':
      return {
        title: heading('{{WORKFLOW}}', verb, 'on {{BRANCH}}'),
        body: '',
        fields: [REPOSITORY, COMMIT, field('Pushed by', '{{AUTHOR}}')],
        links: [RUN_LINK],
      };
    case 'deployment':
      return {
        title: heading('Deployment', verb),
        body: '',
        fields: [field('Environment', '{{ENVIRONMENT}}'), REPOSITORY, BRANCH, COMMIT, ACTOR],
        links: [RUN_LINK],
      };
    case 'release':
      return {
        title: heading(
          'Release {{TAG}}',
          status.known && status.status === 'success' ? 'published' : verb,
        ),
        body: '',
        fields: [REPOSITORY, ACTOR],
        links: [{ label: 'View release', url: '{{RELEASE_URL}}' }, RUN_LINK],
      };
    case 'pull_request':
      return {
        title: heading('{{WORKFLOW}}', verb, '· PR #{{PR_NUMBER}}'),
        body: '',
        fields: [field('Pull request', '{{PR_TITLE}}', false), REPOSITORY, BRANCH, ACTOR, COMMIT],
        links: [{ label: 'View pull request', url: '{{PR_URL}}' }, RUN_LINK],
      };
    case 'issue':
      return {
        title: heading('Issue #{{ISSUE_NUMBER}}:', '{{ISSUE_TITLE}}'),
        body: '',
        fields: [REPOSITORY, field('Event', '{{EVENT}}'), ACTOR],
        links: [{ label: 'View issue', url: '{{ISSUE_URL}}' }],
      };
    case 'custom':
      return { title: '', body: '', fields: [], links: [] };
  }
}
