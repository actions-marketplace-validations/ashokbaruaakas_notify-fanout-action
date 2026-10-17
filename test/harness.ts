import { vi } from 'vitest';

import type { ActionIO } from '../src/io.js';
import type { Dependencies } from '../src/main.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { fakeProvider } from './fake-provider.js';

export interface Recorded {
  logs: { level: 'info' | 'warning' | 'error' | 'debug'; message: string }[];
  outputs: Record<string, string>;
  secrets: string[];
  failed: string | undefined;
  summary: string[];
  /** Every string the action wrote anywhere, for leak checks. */
  everything(): string;
  results(): {
    id: string;
    provider: string;
    ok: boolean;
    attempts: number;
    message_id?: string;
    error?: string;
  }[];
}

export function recordingIO(inputs: Record<string, string>): { io: ActionIO; recorded: Recorded } {
  const recorded: Recorded = {
    logs: [],
    outputs: {},
    secrets: [],
    failed: undefined,
    summary: [],
    everything() {
      return [
        ...this.logs.map((l) => l.message),
        ...Object.values(this.outputs),
        this.failed ?? '',
        ...this.summary,
      ].join('\n');
    },
    results() {
      return JSON.parse(this.outputs.results ?? '[]') as ReturnType<Recorded['results']>;
    },
  };
  const io: ActionIO = {
    getInput: (name) => (inputs[name] ?? '').trim(),
    info: (message) => recorded.logs.push({ level: 'info', message }),
    warning: (message) => recorded.logs.push({ level: 'warning', message }),
    error: (message) => recorded.logs.push({ level: 'error', message }),
    debug: (message) => recorded.logs.push({ level: 'debug', message }),
    setSecret: (value) => recorded.secrets.push(value),
    setOutput: (name, value) => {
      recorded.outputs[name] = value;
    },
    setFailed: (message) => {
      recorded.failed = message;
    },
    appendSummary: (html) => {
      recorded.summary.push(html);
      return Promise.resolve();
    },
  };
  return { io, recorded };
}

/** A fetch mock answering each request with the next scripted response (the last one repeats). */
export function scriptedFetch(...responses: (Response | Error | (() => Response))[]) {
  let call = 0;
  return vi.fn<typeof fetch>(() => {
    const next = responses[Math.min(call++, responses.length - 1)];
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(
      typeof next === 'function' ? next() : (next ?? new Response('{}')).clone(),
    );
  });
}

export const okResponse = (id = '1'): Response => Response.json({ id });

export function dependencies(
  io: ActionIO,
  overrides: Partial<Dependencies> & { files?: Record<string, string> } = {},
): Dependencies {
  const { files = {}, ...rest } = overrides;
  return {
    io,
    env: {},
    registry: new ProviderRegistry().register(fakeProvider),
    readFile: (path) =>
      Object.hasOwn(files, path)
        ? Promise.resolve(files[path] ?? '')
        : Promise.reject(new Error(`ENOENT: ${path}`)),
    fetch: scriptedFetch(okResponse()),
    sleep: () => Promise.resolve(),
    random: () => 0.5,
    cwd: '/repo',
    ...rest,
  };
}
