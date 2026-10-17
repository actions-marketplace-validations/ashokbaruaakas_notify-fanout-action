export const STATUSES = ['success', 'failure', 'cancelled', 'warning', 'info', 'started'] as const;
export type Status = (typeof STATUSES)[number];

/**
 * How `Message.body` is written: plain text, the neutral markdown subset, or
 * the provider's native format passed through untouched.
 */
export const FORMATS = ['text', 'markdown', 'raw'] as const;
export type Format = (typeof FORMATS)[number];

export interface Field {
  name: string;
  value: string;
  short: boolean;
}

export interface Link {
  label: string;
  url: string;
}

/** Provider-neutral message. Providers render it into their native format. */
export interface Message {
  /** Always plain text. */
  title: string;
  body: string;
  format: Format;
  status: Status;
  fields: Field[];
  links: Link[];
}

export const STATUS_EMOJI: Record<Status, string> = {
  success: '✅',
  failure: '❌',
  cancelled: '⚪',
  warning: '⚠️',
  info: 'ℹ️',
  started: '⏳',
};

export interface ResolvedStatus {
  status: Status;
  /** The text shown for `{{STATUS}}`: the known status, or the custom value as given. */
  label: string;
  known: boolean;
}

/** Maps the `status` input to a known status. Custom values are shown as-is with the `info` style. */
export function resolveStatus(input: string): ResolvedStatus {
  const label = input.trim();
  if (label === '') return { status: 'info', label: 'info', known: true };
  const status = STATUSES.find((s) => s === label.toLowerCase());
  return status ? { status, label: status, known: true } : { status: 'info', label, known: false };
}
