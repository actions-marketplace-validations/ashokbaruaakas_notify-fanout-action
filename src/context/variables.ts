export type Env = Readonly<Record<string, string | undefined>>;

/** Variables taken from the GitHub context. Message variables are added by `composeMessage`. */
export const CONTEXT_VARIABLES = [
  'REPOSITORY',
  'BRANCH',
  'WORKFLOW',
  'JOB',
  'EVENT',
  'COMMIT',
  'COMMIT_SHORT',
  'COMMIT_MESSAGE',
  'AUTHOR',
  'RUN_URL',
  'RUN_NUMBER',
  'SERVER_URL',
  'ENVIRONMENT',
  'PR_NUMBER',
  'PR_TITLE',
  'PR_URL',
  'ISSUE_NUMBER',
  'ISSUE_TITLE',
  'ISSUE_URL',
  'TAG',
  'RELEASE_URL',
] as const;
export type ContextVariable = (typeof CONTEXT_VARIABLES)[number];

/** Reads a nested value from untrusted JSON without assuming its shape. */
function pick(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.trim() ?? '';
}

/** Every variable is always present; values missing for this event are empty strings. */
export function buildVariables(env: Env, payload: unknown): Map<string, string> {
  const e = (name: string): string => env[name] ?? '';
  const serverUrl = e('GITHUB_SERVER_URL') || 'https://github.com';
  const repository = e('GITHUB_REPOSITORY');
  const runId = e('GITHUB_RUN_ID');
  const ref = e('GITHUB_REF');

  const pr = pick(payload, 'pull_request');
  const issue = pick(payload, 'issue');
  const release = pick(payload, 'release');
  // On pull requests GITHUB_SHA is the merge commit, not the head the author pushed.
  const commit = text(pick(pr, 'head', 'sha')) || e('GITHUB_SHA');
  const tag =
    text(pick(release, 'tag_name')) || (ref.startsWith('refs/tags/') ? ref.slice(10) : '');

  const values: Record<ContextVariable, string> = {
    REPOSITORY: repository,
    BRANCH: e('GITHUB_HEAD_REF') || (ref.startsWith('refs/heads/') ? e('GITHUB_REF_NAME') : ''),
    WORKFLOW: e('GITHUB_WORKFLOW'),
    JOB: e('GITHUB_JOB'),
    EVENT: e('GITHUB_EVENT_NAME'),
    COMMIT: commit,
    COMMIT_SHORT: commit.slice(0, 7),
    COMMIT_MESSAGE: firstLine(text(pick(payload, 'head_commit', 'message'))),
    AUTHOR: e('GITHUB_ACTOR'),
    RUN_URL: repository && runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : '',
    RUN_NUMBER: e('GITHUB_RUN_NUMBER'),
    SERVER_URL: serverUrl,
    ENVIRONMENT: text(pick(payload, 'deployment', 'environment')),
    PR_NUMBER: text(pick(pr, 'number')),
    PR_TITLE: text(pick(pr, 'title')),
    PR_URL: text(pick(pr, 'html_url')),
    ISSUE_NUMBER: text(pick(issue, 'number')),
    ISSUE_TITLE: text(pick(issue, 'title')),
    ISSUE_URL: text(pick(issue, 'html_url')),
    TAG: tag,
    RELEASE_URL: text(pick(release, 'html_url')),
  };
  return new Map(Object.entries(values));
}

/** Loads the event payload. A missing or unreadable payload yields `{}`. */
export async function loadEventPayload(
  env: Env,
  readFile: (path: string) => Promise<string>,
): Promise<unknown> {
  const path = env.GITHUB_EVENT_PATH;
  if (!path) return {};
  try {
    return JSON.parse(await readFile(path)) as unknown;
  } catch {
    return {};
  }
}
