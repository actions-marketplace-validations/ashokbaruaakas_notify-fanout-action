import type { DeliveryResult } from '../engine/deliver.js';
import type { ActionIO } from '../io.js';
import type { Redactor } from './redact.js';

export interface Logger {
  info(message: string): void;
  warning(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

/** A logger that redacts every message. With `verbose`, debug lines are shown as info. */
export function createLogger(io: ActionIO, redactor: Redactor, verbose: boolean): Logger {
  const r = (message: string): string => redactor.redact(message);
  return {
    info: (message) => {
      io.info(r(message));
    },
    warning: (message) => {
      io.warning(r(message));
    },
    error: (message) => {
      io.error(r(message));
    },
    debug: (message) => {
      if (verbose) io.info(`[debug] ${r(message)}`);
      else io.debug(r(message));
    },
  };
}

export function writeOutputs(
  io: ActionIO,
  redactor: Redactor,
  results: readonly DeliveryResult[],
): void {
  // Redact values, not the serialized JSON, so the output stays valid JSON.
  const r = (value: string): string => redactor.redact(value);
  const json = results.map((result) => ({
    id: r(result.id),
    provider: result.provider,
    ok: result.ok,
    attempts: result.attempts,
    ...(result.messageId === undefined ? {} : { message_id: r(result.messageId) }),
    ...(result.error === undefined ? {} : { error: r(result.error) }),
  }));
  const succeeded = results.filter((result) => result.ok).length;
  io.setOutput('results', JSON.stringify(json));
  io.setOutput('success-count', String(succeeded));
  io.setOutput('failure-count', String(results.length - succeeded));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderSummary(
  redactor: Redactor,
  results: readonly DeliveryResult[],
  dryRun: boolean,
): string {
  const cell = (value: string): string => `<td>${escapeHtml(redactor.redact(value))}</td>`;
  const rows = results.map((r) => {
    const status = dryRun
      ? '📝 dry run'
      : r.ok
        ? '✅ sent'
        : `❌ failed: ${r.error ?? 'unknown error'}`;
    return `<tr>${cell(r.id)}${cell(r.provider)}${cell(status)}${cell(String(r.attempts))}</tr>`;
  });
  return [
    '<h3>Notify Fanout</h3>',
    '<table>',
    '<tr><th>Target</th><th>Provider</th><th>Status</th><th>Attempts</th></tr>',
    ...rows,
    '</table>',
  ].join('\n');
}
